-- NAS（单用户）：cases 加 remind_rules 列 + 建 ical_tokens 表
-- 执行方式：SSH 进 NAS 后 docker exec -i supabase-selfhosted-db-1 psql -U postgres -d postgres < 本文件

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS remind_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.cases.remind_rules IS '到期提醒提前量数组，ISO8601 duration，如 ["PT1H","P1D","PT90M"]；空数组=不提醒';

CREATE TABLE IF NOT EXISTS public.ical_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  last_used_at timestamptz,
  revoked boolean NOT NULL DEFAULT false
);

-- NAS 单用户：全放开（无 user_id 维度）
ALTER TABLE public.ical_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ical_nas_all ON public.ical_tokens;
CREATE POLICY ical_nas_all ON public.ical_tokens FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ical_tokens TO anon, authenticated, service_role;
