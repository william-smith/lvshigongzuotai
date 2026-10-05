-- NAS 日历标题一致性自测：验证接案标题为「委托人 · 接案 · 事项」
-- 事务内执行 + 事后校验 + ROLLBACK，绝不留测试数据
\set ON_ERROR_STOP on
BEGIN;

-- 造一条真实姓名接案：事项=约谈，节点时间=明天 10:00，提醒规则 P2D
INSERT INTO intakes (id, client, next_due, remind_rules, next_action, converted, updated_at)
VALUES (
  999999998,
  '胡玉平',
  (date_trunc('day', now() + interval '1 day') + interval '10 hours')::timestamp,
  '["P2D"]'::jsonb,
  '约谈',
  false,
  now()
);

-- 造一条不填事项的接案，验证回落「接案跟踪」
INSERT INTO intakes (id, client, next_due, remind_rules, next_action, converted, updated_at)
VALUES (
  999999997,
  '测试回落',
  (date_trunc('day', now() + interval '2 day') + interval '14 hours')::timestamp,
  '[]'::jsonb,
  NULL,
  false,
  now()
);

-- 插一个订阅 token（用固定明文 key，测完随事务回滚）
INSERT INTO ical_tokens (id, token_hash, created_at, revoked)
VALUES (
  gen_random_uuid(),
  encode(digest('e2e-nas-cal-title-test', 'sha256'), 'hex'),
  now(),
  false
);

\echo '--- 生成 ICS，提取 SUMMARY 行 ---'
SELECT regexp_replace(x, '\r?\n', ' | ', 'g') AS summary_line
FROM (
  SELECT unnest(string_to_array(public.calendar_ics('e2e-nas-cal-title-test'), E'\n')) AS x
) t
WHERE x LIKE 'SUMMARY:%';

\echo '--- 期望：胡玉平 · 接案 · 约谈  与  测试回落 · 接案跟踪 ---'

\echo '--- 事后校验（应全为 0）---'
SELECT
  (SELECT count(*) FROM intakes WHERE id IN (999999998, 999999997)) AS leftover_intakes,
  (SELECT count(*) FROM ical_tokens WHERE token_hash = encode(digest('e2e-nas-cal-title-test','sha256'),'hex')) AS leftover_tokens;

ROLLBACK;
