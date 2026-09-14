-- 迁移：案件「下一节点」时间精确到分钟
-- cases.next_due 原先是 date，无法保存「几点几分」。改为 timestamp（无时区，与前端 datetime-local 一致）。
--
-- 执行方式（二选一）：
--   A. Supabase 控制台 → SQL Editor 粘贴本文件执行
--   B. 命令行（需 sbp_ 开头的 Personal Access Token）：
--      node scripts/run_sql_mgmt.mjs --token sbp_xxx --file supabase/migrate_2026-09-14_cases_next_due_timestamp.sql
--
-- 影响：
--   - 旧数据（仅日期，如 2026-09-14）统一补成当日 09:00:00（using 子句 +9 小时）。
--   - 新建/编辑由前端默认填 09:00，带时间的值原样写入。
--   - 依赖 next_due 的索引随列类型变更自动重建，显式重建一次确保万无一失。

-- 1. 改列类型：date → timestamp，旧值补 9 点
alter table public.cases
  alter column next_due type timestamp without time zone
  using (next_due::timestamp without time zone + interval '9 hours');

-- 2. 索引随列类型变更会自动重建；显式重建一次确保万无一失
drop index if exists public.idx_cases_due;
create index if not exists idx_cases_due on public.cases (next_due);

-- 校验：确认列已变为 timestamp，且旧数据已补 9 点
-- select next_due from public.cases where next_due is not null order by next_due limit 5;
