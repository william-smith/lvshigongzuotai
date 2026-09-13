-- ============================================================================
-- 律师工作台 · 多用户 RLS 隔离模板（按 auth.uid()）
-- ----------------------------------------------------------------------------
-- 状态：⚠️ 预置，未启用。当前为单用户（schema.sql / docs_schema.sql 里
--       auth.role()='authenticated' 统一放行）。本文件只在「需要多人协作、
--       各看各的案件」时，由管理员在 Supabase 控制台 → SQL Editor 单独执行。
--
-- 设计要点：
--   1. 只在【根表】cases / intakes 上新增 owner_id（谁建的归谁）。
--   2. 子表（timeline / expenses / materials / case_folders / contacts）不新增列，
--      改用「子查询策略」沿 case_id（或 intake_id）继承案件归属，零回填成本。
--   3. vault_meta 故意【不】隔离：它只存 KDF salt + 一个用密钥加密的校验串，
--      不含密钥也不含明文，被其他用户读到也无法解密任何客户数据；保持现状
--      （所有已登录用户可读写）最简单也最安全。若将来要「每个律师独立保险箱
--      口令、互不可解密」，那是更大的应用层改造，不在本模板范围。
--
-- 执行前必读（顺序很重要）：
--   A. 把第 ② 段里的 'REPLACE_WITH_CURRENT_USER_UUID' 换成当前唯一用户
--      william-smith@live.cn 的真实 UUID（控制台 Authentication → Users 查）。
--      未替换就执行会因 uuid 转换失败而整体回滚——这是故意的防呆。
--   B. 本文件一次性执行（SQL Editor 默认整段包在事务里，任一段失败全回滚）。
--   C. 启用后，不要再直接重跑 schema.sql / docs_schema.sql 末尾的 do $$ 循环，
--      那段会把本模板的策略覆盖回统一放行（见文末「与建表脚本的冲突」）。
--   D. 需要配合的前端改动见文末清单；不改的话新写入会被 with check 拦下。
-- ============================================================================


-- ① 根表加 owner_id（先 nullable，便于回填旧数据） --------------------------
alter table public.cases    add column if not exists owner_id uuid;
alter table public.intakes  add column if not exists owner_id uuid;


-- ② 回填旧数据到当前唯一用户（单用户时期录入的全部行） ----------------------
--    直接从 auth.users 查出 william-smith@live.cn 的 UUID，避免手抄出错；
--    若将来变成多用户，本段需改为按各用户分别回填（见文末说明）。
do $$
declare
  v_owner uuid := (select id from auth.users where email = 'william-smith@live.cn' limit 1);
begin
  if v_owner is null then
    raise exception '在 auth.users 中找不到 william-smith@live.cn，请确认该账号已存在';
  end if;
  update public.cases   set owner_id = v_owner where owner_id is null;
  update public.intakes set owner_id = v_owner where owner_id is null;
  raise notice 'backfilled owner_id = %', v_owner;
end $$;


-- ③ 设默认值 + 非空约束（之后通过前端的写入自动归属当前登录用户） -----------
alter table public.cases    alter column owner_id set default auth.uid();
alter table public.intakes  alter column owner_id set default auth.uid();
alter table public.cases    alter column owner_id set not null;
alter table public.intakes  alter column owner_id set not null;


-- ④ 替换行级安全策略 --------------------------------------------------------
-- 4a. 先删除当前的统一放行策略（p_auth_* / p_all_*）
drop policy if exists p_auth_cases     on public.cases;
drop policy if exists p_all_cases      on public.cases;
drop policy if exists p_auth_intakes   on public.intakes;
drop policy if exists p_all_intakes    on public.intakes;
drop policy if exists p_auth_contacts  on public.contacts;
drop policy if exists p_all_contacts   on public.contacts;
drop policy if exists p_auth_timeline  on public.timeline;
drop policy if exists p_all_timeline   on public.timeline;
drop policy if exists p_auth_expenses  on public.expenses;
drop policy if exists p_all_expenses   on public.expenses;
drop policy if exists p_auth_materials on public.materials;
drop policy if exists p_all_materials  on public.materials;
drop policy if exists p_auth_case_folders on public.case_folders;
drop policy if exists p_all_case_folders  on public.case_folders;

-- 4b. cases / intakes：直接按 owner_id 隔离
create policy p_owner_cases on public.cases
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy p_owner_intakes on public.intakes
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- 4c. 子表：沿 case_id 继承案件归属（不新增列、不回填）
create policy p_owner_timeline on public.timeline
  for all to authenticated
  using (exists (
    select 1 from public.cases c where c.id = timeline.case_id and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from public.cases c where c.id = timeline.case_id and c.owner_id = auth.uid()));

create policy p_owner_expenses on public.expenses
  for all to authenticated
  using (exists (
    select 1 from public.cases c where c.id = expenses.case_id and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from public.cases c where c.id = expenses.case_id and c.owner_id = auth.uid()));

create policy p_owner_materials on public.materials
  for all to authenticated
  using (exists (
    select 1 from public.cases c where c.id = materials.case_id and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from public.cases c where c.id = materials.case_id and c.owner_id = auth.uid()));

create policy p_owner_case_folders on public.case_folders
  for all to authenticated
  using (exists (
    select 1 from public.cases c where c.id = case_folders.case_id and c.owner_id = auth.uid()))
  with check (exists (
    select 1 from public.cases c where c.id = case_folders.case_id and c.owner_id = auth.uid()));

-- 4d. contacts：同时挂 case_id 与 intake_id，两条路都校验归属
create policy p_owner_contacts on public.contacts
  for all to authenticated
  using (
    (case_id is not null   and exists (select 1 from public.cases c    where c.id    = contacts.case_id    and c.owner_id    = auth.uid()))
    or
    (intake_id is not null and exists (select 1 from public.intakes i  where i.id    = contacts.intake_id  and i.owner_id    = auth.uid()))
  )
  with check (
    (case_id is not null   and exists (select 1 from public.cases c    where c.id    = contacts.case_id    and c.owner_id    = auth.uid()))
    or
    (intake_id is not null and exists (select 1 from public.intakes i  where i.id    = contacts.intake_id  and i.owner_id    = auth.uid()))
  );

-- 4e. vault_meta：保持原样（所有已登录用户可读写），不挂 owner 策略。
--     理由见文件头：其中不含密钥/明文，读到也无法解密客户数据。


-- ============================================================================
-- ⑤ 回退脚本（独立执行，不要和上面 ①②③④ 一起跑）
--    恢复到单用户统一放行，并移除 owner_id 列。仅在放弃多用户时使用。
-- ============================================================================
/*
-- 5a. 删除隔离策略
drop policy if exists p_owner_cases        on public.cases;
drop policy if exists p_owner_intakes      on public.intakes;
drop policy if exists p_owner_contacts     on public.contacts;
drop policy if exists p_owner_timeline     on public.timeline;
drop policy if exists p_owner_expenses     on public.expenses;
drop policy if exists p_owner_materials    on public.materials;
drop policy if exists p_owner_case_folders on public.case_folders;

-- 5b. 恢复统一放行策略（与 schema.sql / docs_schema.sql 原写法一致）
do $$
declare t text;
begin
  foreach t in array array['cases','intakes','contacts','timeline','expenses','materials','case_folders']
  loop
    execute format('drop policy if exists p_auth_%1$s on public.%1$I', t);
    execute format(
      'create policy p_auth_%1$s on public.%1$I for all to authenticated using (auth.role() = %2$L) with check (auth.role() = %2$L)',
      t, 'authenticated');
  end loop;
end $$;

-- 5c. 移除 owner_id 列（可选；保留也无害）
alter table public.cases   drop column if exists owner_id;
alter table public.intakes drop column if exists owner_id;
*/


-- ============================================================================
-- ⑥ 与建表脚本的冲突（务必知悉）
--    schema.sql 末尾与 docs_schema.sql 末尾各有一段 do $$ 循环，每次执行都会
--    drop policy if exists p_auth_* 再 recreate 统一放行策略。一旦你启用本模板后
--    又重跑那两个文件，p_owner_* 不会被删（循环只认 p_auth_/p_all_），但 p_auth_*
--    会被重新挂上 → 两种策略 AND 叠加，结果仍是「只显示自己拥有的数据」（安全），
--    只是表里会同时挂着两套策略，显得脏。
--    建议：启用多用户后，把那两段循环里的建策略部分删掉（或改成调用本文件），
--    只保留 enable row level security 即可。
-- ============================================================================


-- ============================================================================
-- ⑦ 启用后需要的前端改动清单（不改则新数据写不进库）
--    1. 无需为 owner_id 单独赋值：cases / intakes 插入时靠列默认值 auth.uid()
--       自动归属当前登录用户，with check 通过。
--    2. 子表写入（timeline / expenses / materials / case_folders / contacts）
--       必须带正确的 case_id / intake_id，且该父记录属于当前用户，否则 with check
--       拦截。当前前端已都带 case_id，逻辑无需改。
--    3. 列表查询：原 SQL 不限定 owner_id，RLS 会在服务端自动按 auth.uid() 过滤，
--       前端代码无需改动即可只取到自己的数据。
--    4. 若将来要做「共享案件给助理」：本模板不支持，需另写 role/owner 数组策略，
--       不在本次范围。
-- ============================================================================
