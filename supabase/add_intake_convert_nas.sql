-- 接案转案件：记录 intakes 关联的案件（自建库 = 单用户，无 user_id）
ALTER TABLE public.intakes ADD COLUMN IF NOT EXISTS case_id bigint;
COMMENT ON COLUMN public.intakes.case_id IS '由该接案转成的案件 id；为空=尚未转案。比 converted 布尔标记更可靠（能定位到具体案件、可防重复转换）';

-- 转案时把联系人电话从 intake 迁到 case（contacts 已有 case_id 列，此前一直只用 intake_id）
CREATE INDEX IF NOT EXISTS idx_intakes_case_id ON public.intacts(case_id);
CREATE INDEX IF NOT EXISTS idx_contacts_case_id ON public.contacts(case_id);
