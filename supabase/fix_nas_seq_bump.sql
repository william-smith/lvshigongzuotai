-- ============================================================================
-- NAS 自建库：修复 identity 序列错位 + 补 sync_bump_seq RPC
--
-- 症状：NAS 端 timeline（及可能的 cases/intakes/expenses/contacts/materials/
--       case_folders）删除中间一条后再新建，报 409 / 23505
--       "duplicate key value violates unique constraint ..._pkey"
--
-- 根因：同步把云端的高 id 显式写进 NAS 后，NAS 的 identity 序列没跟着顶到
--       max(id)+1，之后 NAS 原生 INSERT（省略 id 自增）撞上已存在的高 id。
--       代码侧已补「写 NAS 后调 bumpSeq」；本脚本负责把 NAS 现有序列立即对齐，
--       并确保 sync_bump_seq RPC 在 NAS 上也存在（供后续同步自动对齐）。
--
-- 执行方式（SSH 进 NAS）：
--   ssh admin@192.168.31.246 \
--     'docker exec -i supabase-selfhosted-db-1 psql -U postgres -d postgres -v ON_ERROR_STOP=1' < fix_nas_seq_bump.sql
--
-- 幂等：可重复执行，只改序列、不动数据。
-- ============================================================================

-- ---------- 1) 建 sync_bump_seq RPC（云端 add_sync_bump_seq.sql 同款，NAS 侧补齐） ----------
create or replace function public.sync_bump_seq(p_tbl text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seq text;
  mx  bigint;
begin
  if p_tbl not in ('cases','intakes','timeline','expenses',
                   'contacts','materials','case_folders') then
    raise notice 'sync_bump_seq: 未知表 %，跳过', p_tbl;
    return;
  end if;
  seq := pg_get_serial_sequence(format('public.%I', p_tbl), 'id');
  if seq is not null then
    execute format('select coalesce(max(id),0) from public.%I', p_tbl) into mx;
    perform setval(seq, mx + 1, false);
    raise notice 'sync_bump_seq: % 序列对齐到 %', p_tbl, mx + 1;
  end if;
end $$;

grant execute on function public.sync_bump_seq(text) to authenticated, service_role;

-- ---------- 2) 立即对齐所有业务表序列（幂等，可重复跑） ----------
do $$
declare
  t   text;
  seq text;
  mx  bigint;
begin
  foreach t in array array['cases','intakes','timeline','expenses',
                           'contacts','materials','case_folders']
  loop
    seq := pg_get_serial_sequence(format('public.%I', t), 'id');
    if seq is not null then
      execute format('select coalesce(max(id),0) from public.%I', t) into mx;
      perform setval(seq, mx + 1, false);
      raise notice '%: 序列 % 已对齐到 %', t, seq, mx + 1;
    else
      raise notice '%: 无 serial/identity 序列，跳过', t;
    end if;
  end loop;
end $$;

-- ---------- 3) 自检（应看到每表 max_id 与 seq_last_value 一致，且 seq > max） ----------
-- select 'timeline' tbl, coalesce(max(id),0) max_id, (select last_value from public.timeline_id_seq) seq_last
-- from public.timeline;
