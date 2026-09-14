-- 迁移：案件时间线节点时间精确到分钟
-- 时间线节点（timeline.at）原先是 date，无法保存「几点几分」。
-- 改为 timestamp（无时区，按律师本地挂钟时间存储），与前端 datetime-local 一致。
--
-- 执行方式（二选一）：
--   A. Supabase 控制台 → SQL Editor 粘贴本文件执行
--   B. 命令行（需 sbp_ 开头的 Personal Access Token）：
--      node scripts/run_sql_mgmt.mjs --token sbp_xxx --file supabase/migrate_2026-09-14_timeline_at_timestamp.sql
--
-- 影响：
--   - 旧数据（仅日期）自动补为当日 00:00:00；新建节点由前端默认填 09:00。
--   - 依赖 at 的索引会随列类型变更自动重建，无需手动处理。

-- 1. 改列类型：date → timestamp（无时区）
alter table public.timeline
  alter column at type timestamp without time zone
  using at::timestamp without time zone;

-- 2. 索引随列类型变更会自动重建；显式重建一次确保万无一失
drop index if exists public.idx_timeline_case;
create index if not exists idx_timeline_case on public.timeline (case_id, at desc);

-- 校验：确认列已变为 timestamp
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'timeline' and column_name = 'at';
