-- ============================================================
-- 律师工作台 · Postgres 建表脚本（Supabase / CloudBase 通用）
-- 安全模型：敏感字段（手机号、伤情、详细情况）在客户端 AES-256-GCM
--           加密后才写入，数据库只存密文 + 一份脱敏明文副本。
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 案件（由「办案进度表」迁移而来） ----------
create table if not exists public.cases (
  id             bigint primary key,
  client         text not null,          -- 委托人姓名（明文，办案要用）
  cause          text,                   -- 案由
  stage          text,                   -- 阶段：一审/仲裁/结案…
  stage_norm     text,                   -- 归一化阶段：在办/结案/解除委托
  next_action    text,                   -- 下一步工作
  next_due       date,                   -- 下一步日期（临期计算依据）
  first_contact  date,
  signed_at      date,
  detail_mask    text,                   -- 脱敏后的详细情况（可明文检索展示）
  detail_enc     text,                   -- 详细情况原文密文（v1:iv:ct）
  has_secret     boolean default false,  -- 是否含需解锁内容
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_cases_due   on public.cases (next_due);
create index if not exists idx_cases_stage on public.cases (stage_norm);
create index if not exists idx_cases_client on public.cases (client);

-- ---------- 接案线索（含未签单） ----------
create table if not exists public.intakes (
  id             bigint primary key,
  client         text,
  first_contact  date,
  signed_at      date,
  converted      boolean default false,  -- 是否已转成案件
  note_mask      text,                   -- 脱敏跟踪记录
  note_enc       text,                   -- 跟踪记录原文密文
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_intakes_client on public.intakes (client);

-- ---------- 加密联系方式 ----------
create table if not exists public.contacts (
  id             bigserial primary key,
  intake_id      bigint references public.intakes(id) on delete cascade,
  case_id        bigint references public.cases(id) on delete cascade,
  label          text,                   -- 本人 / 家属 / 对方
  phone_mask     text,                   -- 138****5678（明文，用于列表与搜索）
  phone_enc      text,                   -- 完整号码密文
  note_enc       text,
  created_at     timestamptz default now()
);
create index if not exists idx_contacts_case on public.contacts (case_id);
create index if not exists idx_contacts_mask on public.contacts (phone_mask);

-- ---------- 案件时间线 ----------
create table if not exists public.timeline (
  id             bigint primary key,
  case_id        bigint references public.cases(id) on delete cascade,
  at             date,
  content_mask   text,
  content_enc    text,
  created_at     timestamptz default now()
);
create index if not exists idx_timeline_case on public.timeline (case_id, at desc);

-- ---------- 费用 ----------
create table if not exists public.expenses (
  id             bigint primary key,
  case_id        bigint references public.cases(id) on delete cascade,
  direction      text,                   -- 收 / 支
  category       text,
  at             date,
  amount         numeric(12,2),
  personal       numeric(12,2),
  detail         text,                   -- 脱敏摘要
  detail_enc     text,
  created_at     timestamptz default now()
);
create index if not exists idx_expenses_case on public.expenses (case_id);

-- ---------- 材料（文书与证据） ----------
-- storage: 'cloud' 仅云端 | 'local' 仅本机 | 'both' 云端+本机
create table if not exists public.materials (
  id             bigserial primary key,
  case_id        bigint references public.cases(id) on delete cascade,
  name           text not null,
  kind           text,                   -- 证据材料 / 法律文书 / 程序材料
  storage        text default 'local',
  size_bytes     bigint,
  hash           text,
  local_path_enc text,                   -- 本机路径（加密，避免泄露目录结构）
  remote_key     text,                   -- 云端对象键（若上云）
  updated_at     timestamptz default now()
);
create index if not exists idx_materials_case on public.materials (case_id, kind);

-- ---------- 保险箱元数据（口令校验用，不含密钥） ----------
create table if not exists public.vault_meta (
  id             smallint primary key default 1,
  kdf            text default 'PBKDF2-SHA256',
  iterations     int  default 210000,
  salt           text,                   -- 明文 salt（不敏感）
  verifier_enc   text,                   -- 用密钥加密的固定串，用于校验口令是否正确
  updated_at     timestamptz default now()
);

-- ============================================================
-- 行级安全（RLS）
--
-- 策略：只有「已登录」才能读写，未登录（只持有 anon key）一条都读不到。
-- 这样才能把前端部署到公网——anon key 本来就打在前端代码里，
-- 光靠它是拿不到数据的，必须先过邮箱密码这一关。
--
-- 前提：控制台 Authentication → Sign In / Providers 里
--       打开 Email，并关闭 Allow new users to sign up（禁止陌生人自助注册）。
--       建账号用 scripts/setup_auth.mjs 一次搞定。
--
-- 若要多人协作、各看各的：已备好隔离模板 supabase/rls_uid_isolation.sql
-- （按 auth.uid() 隔离，只给 cases/intakes 加 owner_id，子表沿 case_id 继承）。
-- 当前保持单用户统一放行；启用多用户时单独执行该模板文件，并按文末清单改前端。
-- ============================================================
alter table public.cases     enable row level security;
alter table public.intakes   enable row level security;
alter table public.contacts  enable row level security;
alter table public.timeline  enable row level security;
alter table public.expenses  enable row level security;
alter table public.materials enable row level security;
alter table public.vault_meta enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cases','intakes','contacts','timeline','expenses','materials','vault_meta']
  loop
    execute format('drop policy if exists p_all_%1$s on public.%1$I', t);
    execute format('drop policy if exists p_auth_%1$s on public.%1$I', t);
    execute format(
      'create policy p_auth_%1$s on public.%1$I for all to authenticated using (auth.role() = %2$L) with check (auth.role() = %2$L)',
      t, 'authenticated');
  end loop;
end $$;
