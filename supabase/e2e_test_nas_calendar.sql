-- NAS 日历订阅端到端自测：临时插入一条接案 → 调用 calendar_ics → 校验 VEVENT → 整体 ROLLBACK
-- 全程在一个事务内，绝不留测试数据
BEGIN;

-- 1) 造一个已知明文 key 的 sha256（与 RPC 内部 digest(p_key,'sha256') 算法一致）
INSERT INTO public.ical_tokens (id, token_hash, revoked)
VALUES (gen_random_uuid(), encode(digest('E2E-TEST-KEY-123', 'sha256'), 'hex'), false);

-- 2) 临时接案：明天 09:00 节点 + 两个提醒（提前1小时 / 提前1天）
--    注意：intakes.id 无 DEFAULT（由前端分配），故显式给一个高位测试 id
INSERT INTO public.intakes (id, client, first_contact, converted, next_due, remind_rules)
VALUES (999999999, '自测接案人', CURRENT_DATE, false,
        (date_trunc('day', now()) + interval '1 day 9 hours')::timestamp,
        '["PT1H","P1D"]'::jsonb);

-- 3) 调 RPC
\echo '===== ICS OUTPUT ====='
SELECT public.calendar_ics('E2E-TEST-KEY-123');
\echo '===== END ICS ====='

ROLLBACK;
