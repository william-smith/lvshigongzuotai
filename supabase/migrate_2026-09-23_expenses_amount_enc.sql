-- ============================================================
-- 费用金额加密：新增密文列（幂等，可重复执行）
--
-- 背景：expenses.amount / personal 是明文 numeric，数据库被拿到即可看到金额。
-- 做法：新增 amount_enc / personal_enc 两列存 AES-256-GCM 密文（与 detail_enc 同一套密钥）。
-- 灰度：明文字段**暂时保留**，等脚本 migrate_expense_amounts.mjs 回填并核对无误后，
--       再执行本文件末尾的「清空明文」语句，并把 .env 的 VITE_EXPENSE_ENC_ONLY 置 1。
--
-- 执行方式（Management API，REST 不通时也能跑）：
--   node scripts/run_sql_mgmt.mjs --token sbp_xxx --file supabase/migrate_2026-09-23_expenses_amount_enc.sql
-- ============================================================

alter table public.expenses add column if not exists amount_enc text;
alter table public.expenses add column if not exists personal_enc text;

comment on column public.expenses.amount_enc is '开票金额密文 v1:iv:ct（AES-256-GCM，主口令派生密钥）';
comment on column public.expenses.personal_enc is '个人得金额密文 v1:iv:ct';

-- ------------------------------------------------------------
-- 第二步（确认无误后再单独执行，不要把下面这段一起跑）：
-- 清空明文金额。执行后前端务必设置 VITE_EXPENSE_ENC_ONLY=1 重新构建，
-- 否则前端会把金额明文又写回来。
-- ------------------------------------------------------------
-- update public.expenses set amount = null, personal = null where amount_enc is not null or personal_enc is not null;
