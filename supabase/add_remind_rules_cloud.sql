-- 云端（多租户）：cases 加 remind_rules 列 + 建 ical_tokens 表
-- 执行方式：Supabase Management API POST /database/query（Bearer PAT），或 Dashboard SQL Editor

-- 1) cases 加列：到期提醒提前量数组（ISO8601 duration，如 ["PT1H","P1D","PT90M"]）
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS remind_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.cases.remind_rules IS '到期提醒提前量数组，ISO8601 duration，如 ["PT1H","P1D","PT90M"]；空数组=不提醒';

-- 2) ical_tokens：日历订阅密钥表（多租户）
CREATE TABLE IF NOT EXISTS public.ical_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  token_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  revoked boolean NOT NULL DEFAULT false,
  UNIQUE (user_id, token_hash)
);
CREATE INDEX IF NOT EXISTS idx_ical_tokens_user ON public.ical_tokens(user_id);

ALTER TABLE public.ical_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ical_self ON public.ical_tokens;
CREATE POLICY ical_self ON public.ical_tokens FOR ALL
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 前端（authenticated）生成/吊销自己的订阅 key；service_role（CF Function）只读校验
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ical_tokens TO authenticated, service_role;
