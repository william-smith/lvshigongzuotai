-- ============================================================================
-- 修复：同步把云端行打上了「NAS 自建库的 uid」，导致切回云端登录后
--       RLS（user_id = auth.uid()）把数据整批过滤掉 → 案件列表空。
--
-- 根因：DataSync 同步时 scopeUid 取自「当前生效后端（NAS）」的会话 uid，
--       云端每一行被标成 NAS uid（云端 RLS 里的外来无效值）。
--       代码已修（改读云端会话键 lw.auth.v1.cloud）；本脚本把已写错的行归位。
--
-- 作用范围：仅 cases / intakes / vault_meta 三张「根表」持有 user_id；
--           子表（contacts/timeline/expenses/materials/case_folders）沿 case_id /
--           intake_id 继承归属，RLS 靠父表判定，无需改动。
--
-- ⚠️ 前置：把下方 CLOUD_EMAIL 改成你在云端库注册的邮箱（与 App 登录云端同一个）。
-- ⚠️ 前提：本云端库目前为本人单租户使用。脚本会把「非本人 uid」的根表行统一
--        归位到本人；若日后真有多租户他人数据，请先跑底部自检看清分布再决定。
--
-- 执行：云端库 SQL Editor（需管理员 / service_role 权限）。可重跑，幂等。
-- ============================================================================

do $$
declare target_uid uuid;
begin
  -- 1) 目标 uid = 云端本人账号（与 App 登录云端用的是同一个）
  select id into target_uid from auth.users where email = 'william-smith@live.cn' limit 1;
  if target_uid is null then
    raise exception '未在 auth.users 找到该邮箱，请确认 CLOUD_EMAIL 是否正确';
  end if;

  -- 2) 把根表里「非本人」的 user_id 全部改回本人（即把同步误打的 NAS uid 归位）
  update public.cases      set user_id = target_uid where user_id is distinct from target_uid;
  update public.intakes    set user_id = target_uid where user_id is distinct from target_uid;
  --    vault_meta 有 unique(user_id)（一人一行）：不能改 uid（会与本人行撞唯一约束，
  --    且 DO 块未捕获异常会整段回滚），直接删外来行、保留本人行。
  delete from public.vault_meta where user_id is distinct from target_uid;

  raise notice '已将云端根表 user_id 统一归属到 %', target_uid;
end $$;

-- ============================================================================
-- 自检（执行后跑，应只剩 target_uid 一行；若还有别的 uid 说明存在其他租户数据）：
--   select user_id, count(*) from public.cases group by user_id order by 2 desc;
--   select user_id, count(*) from public.intakes group by user_id order by 2 desc;
-- ============================================================================
