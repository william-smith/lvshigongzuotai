-- 云端（多租户）：intakes 加 next_due + remind_rules 列，使「接案」也能进日历提醒
-- 执行方式：Supabase Management API POST /database/query（Bearer PAT），或 Dashboard SQL Editor
-- 与 cases 保持一致：next_due 为北京时间 naive timestamp；remind_rules 为 ISO8601 duration 数组

-- 1) 节点时间（精确到分钟）。设了才进日历；不设则不进日历（不是每个接案都要提醒）
ALTER TABLE public.intakes ADD COLUMN IF NOT EXISTS next_due timestamp;
COMMENT ON COLUMN public.intakes.next_due IS '接案节点时间（北京时间 naive timestamp，精确到分钟）；不设则不进日历';

-- 2) 到期提醒提前量数组（ISO8601 duration，如 ["PT1H","P1D"]）
ALTER TABLE public.intakes ADD COLUMN IF NOT EXISTS remind_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.intakes.remind_rules IS '到期提醒提前量数组，ISO8601 duration，如 ["PT1H","P1D"]；空数组=不提醒';

-- 3) 建索引，加速日历订阅查询（WHERE next_due IS NOT NULL ORDER BY next_due）
CREATE INDEX IF NOT EXISTS idx_intakes_due ON public.intakes(next_due);
