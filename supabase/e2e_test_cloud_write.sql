-- 云端 intakes 新列写入自测：模拟前端 POST（带 next_due + remind_rules）与 PATCH
-- 注意：本文件走 Supabase Management API 执行，不能用 psql 元命令（\echo 等），只用纯 SQL
-- 全程一个事务，末尾 ROLLBACK，绝不留测试数据
BEGIN;

-- 注意：云端 intakes 有 user_id NOT NULL 约束（多租户），NAS 单用户库无此列
-- 取任一已有用户作为归属；仅在事务内使用，ROLLBACK 后无影响
INSERT INTO public.intakes (id, user_id, client, first_contact, converted, next_due, remind_rules)
SELECT 999999998, u.id, '云端自测接案人', CURRENT_DATE, false,
       (date_trunc('day', now()) + interval '1 day 10 hours')::timestamp,
       '["PT30M","P2D"]'::jsonb
FROM auth.users u
ORDER BY u.created_at
LIMIT 1;

-- 回读 INSERT 结果
SELECT 'after_insert' AS step, id, client, next_due, remind_rules
FROM public.intakes WHERE id = 999999998;

-- 模拟前端 PATCH：只改提醒规则
UPDATE public.intakes
SET remind_rules = '["PT15M"]'::jsonb
WHERE id = 999999998;

SELECT 'after_patch' AS step, id, remind_rules
FROM public.intakes WHERE id = 999999998;

ROLLBACK;
