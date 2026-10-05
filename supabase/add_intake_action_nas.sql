-- 接案「节点事项」：日历订阅里显示具体要做什么（对应案件的 next_action）
-- 自建库 = 单用户表（无 user_id 列）
ALTER TABLE public.intakes ADD COLUMN IF NOT EXISTS next_action text;
COMMENT ON COLUMN public.intakes.next_action IS '接案节点事项（要做什么，如「约时间面谈」「发委托合同」）；日历标题里显示，不设则回落为「接案跟踪」';
