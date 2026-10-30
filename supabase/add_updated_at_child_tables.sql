-- ============================================================================
-- 给三张子表补 updated_at 列，让同步器能按时间自动裁决冲突
--
-- 背景：timeline/contacts/expenses 此前只有 created_at、没有 updated_at。
--   syncOps 的 UPDATED_COL 对这三表设为 null，冲突判定退化为「非空字段数」比较，
--   导致两端同一条记录「字段数相同、密文不同」时永远判为冲突、且重新保存也消不掉。
--   补上 updated_at 后，前端写入会刷新该列，同步器即可按「谁 updated_at 新谁覆盖」自动裁决。
--
-- 幂等：IF NOT EXISTS 保护，可重复执行。云端与 NAS 通用。
-- 默认 now() 保证老数据补齐后至少有一个可比较的时间；之后由前端显式写入。
-- ============================================================================

alter table public.timeline  add column if not exists updated_at timestamptz default now();
alter table public.contacts   add column if not exists updated_at timestamptz default now();
alter table public.expenses   add column if not exists updated_at timestamptz default now();

-- 老数据回填：把 created_at 当作 updated_at 的初始值，避免 NULL 干扰时间比较
update public.timeline  set updated_at = created_at where updated_at is null;
update public.contacts   set updated_at = created_at where updated_at is null;
update public.expenses   set updated_at = created_at where updated_at is null;
