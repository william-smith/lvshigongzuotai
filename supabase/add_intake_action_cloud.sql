-- 接案「节点事项」：日历订阅里显示具体要做什么（对应案件的 next_action）
-- 云端 = 多租户表（已有 user_id）；本文件只加列，不动既有约束
ALTER TABLE public.intakes ADD COLUMN IF NOT EXISTS next_action text;
COMMENT ON COLUMN public.intakes.next_action IS '接案节点事项（要做什么，如「约时间面谈」「发委托合同」）；日历标题里显示，不设则回落为「接案跟踪」';

-- 日历查询按 user_id + next_due 过滤并排序，无需新增索引（idx_intakes_due 已覆盖排序）
