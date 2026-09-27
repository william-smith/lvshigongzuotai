-- ============================================================
-- 律师工作台 · 公开多租户 schema（全新空白 Supabase 项目专用）
-- ------------------------------------------------------------
-- 隔离模型：纯按个人隔离（每位注册律师只看自己的数据，跨账号零串扰）。
--   - 根表 cases / intakes 持有 user_id（默认 auth.uid()，写入自动归属当前登录用户）。
--   - 子表（timeline / expenses / materials / case_folders / contacts）
--     不新增归属列，沿 case_id / intake_id 继承案件归属（零回填成本）。
--   - vault_meta 改为每用户一条（各自独立保险箱口令，互不可解密）。
--   - 管理账号：profiles.role = 'admin' 的用户经 is_admin() 可越过隔离做运维
--     （当前仅数据层放行，后台管理界面为后续功能）。
--
-- 主键：cases / intakes / timeline / expenses 改为 bigint generated always as identity，
--       由数据库发号，避免两个律师本地 max(id) 相同导致主键冲突。
--       materials / contacts / case_folders 本就是 bigserial，保持不变。
--
-- 执行：Supabase 控制台 → SQL Editor → 整段粘贴执行一次。
-- 公开自注册在 Authentication → Providers → Email 里打开（默认开），
-- 并在 Authentication → URL Configuration 把 Site URL 设为线上域名（邮箱验证链接才正确）。
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- profiles（注册时由触发器自动建档） ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'user',   -- 'user' | 'admin'
  created_at timestamptz default now()
);
create index if not exists idx_profiles_role on public.profiles (role);

-- 注册即建档：auth.users 插入后自动建一条 profiles
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 管理账号判定：SECURITY DEFINER 绕开 RLS，直接读 profiles
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ---------- 案件（根表，持有 user_id） ----------
create table if not exists public.cases (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid(),
  client         text not null,
  cause          text,
  stage          text,
  stage_norm     text,
  next_action    text,
  next_due       timestamp,
  first_contact  date,
  signed_at      date,
  detail_mask    text,
  detail_enc     text,
  has_secret     boolean default false,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_cases_user      on public.cases (user_id);
create index if not exists idx_cases_due       on public.cases (next_due);
create index if not exists idx_cases_stage     on public.cases (stage_norm);
create index if not exists idx_cases_client    on public.cases (client);

-- ---------- 接案线索（根表，持有 user_id） ----------
create table if not exists public.intakes (
  id             bigint generated always as identity primary key,
  user_id        uuid not null default auth.uid(),
  client         text,
  first_contact  date,
  signed_at      date,
  converted      boolean default false,
  note_mask      text,
  note_enc       text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_intakes_user    on public.intakes (user_id);
create index if not exists idx_intakes_client  on public.intakes (client);

-- ---------- 加密联系方式（沿 case_id / intake_id 继承归属） ----------
create table if not exists public.contacts (
  id             bigserial primary key,
  intake_id      bigint references public.intakes(id) on delete cascade,
  case_id        bigint references public.cases(id) on delete cascade,
  label          text,
  phone_mask     text,
  phone_enc      text,
  note_enc       text,
  created_at     timestamptz default now()
);
create index if not exists idx_contacts_case   on public.contacts (case_id);
create index if not exists idx_contacts_intake on public.contacts (intake_id);
create index if not exists idx_contacts_mask   on public.contacts (phone_mask);

-- ---------- 案件时间线（沿 case_id 继承） ----------
create table if not exists public.timeline (
  id             bigint generated always as identity primary key,
  case_id        bigint references public.cases(id) on delete cascade,
  at             timestamp,
  content_mask   text,
  content_enc    text,
  created_at     timestamptz default now()
);
create index if not exists idx_timeline_case   on public.timeline (case_id, at desc);

-- ---------- 费用（沿 case_id 继承） ----------
create table if not exists public.expenses (
  id             bigint generated always as identity primary key,
  case_id        bigint references public.cases(id) on delete cascade,
  direction      text,
  category       text,
  at             date,
  amount         numeric(12,2),
  personal       numeric(12,2),
  detail         text,
  detail_enc     text,
  amount_enc     text,
  personal_enc   text,
  created_at     timestamptz default now()
);
create index if not exists idx_expenses_case   on public.expenses (case_id);

-- ---------- 材料索引（沿 case_id 继承；原件留本机） ----------
create table if not exists public.materials (
  id             bigserial primary key,
  case_id        bigint references public.cases(id) on delete cascade,
  name           text not null,
  kind           text,
  storage        text default 'local',
  size_bytes     bigint,
  hash           text,
  local_path_enc text,
  remote_key     text,
  rel_path       text,
  category       smallint default 0,
  category_src   text default 'auto',
  indexed_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create unique index if not exists uq_materials_case_rel
  on public.materials (case_id, rel_path) where rel_path is not null;
create index if not exists idx_materials_case   on public.materials (case_id, kind);
create index if not exists idx_materials_category on public.materials (case_id, category);

-- ---------- 案件 ↔ 同步文件夹绑定（沿 case_id 继承） ----------
create table if not exists public.case_folders (
  id             bigserial primary key,
  case_id        bigint not null references public.cases(id) on delete cascade,
  folder_name    text,
  pc_folder      text,
  mobile_folder  text,
  matched_by     text default 'auto',
  updated_at     timestamptz default now()
);
create unique index if not exists uq_case_folders_case on public.case_folders (case_id);
create index if not exists idx_case_folders_name on public.case_folders (folder_name);

-- ---------- 保险箱元数据（每用户一条，互不共享口令） ----------
create table if not exists public.vault_meta (
  id             smallint primary key default 1,
  user_id        uuid not null default auth.uid(),
  kdf            text default 'PBKDF2-SHA256',
  iterations     int  default 210000,
  salt           text,
  verifier_enc   text,
  updated_at     timestamptz default now(),
  unique (user_id)
);
create index if not exists idx_vault_user on public.vault_meta (user_id);

-- ============================================================
-- 行级安全（RLS）
--   根表：user_id = auth.uid() 才可见可写；管理员（is_admin()）可越权。
--   子表：沿父表归属；管理员可越权。
--   所有表均 enable RLS——anon key 单独持有一条都读不到。
-- ============================================================
alter table public.profiles     enable row level security;
alter table public.cases        enable row level security;
alter table public.intakes      enable row level security;
alter table public.contacts     enable row level security;
alter table public.timeline     enable row level security;
alter table public.expenses     enable row level security;
alter table public.materials    enable row level security;
alter table public.case_folders enable row level security;
alter table public.vault_meta   enable row level security;

-- 清掉任何旧的统一放行策略，避免叠加
do $$
declare t text;
begin
  foreach t in array array['profiles','cases','intakes','contacts','timeline','expenses','materials','case_folders','vault_meta']
  loop
    execute format('drop policy if exists p_auth_%1$s on public.%1$I', t);
    execute format('drop policy if exists p_all_%1$s on public.%1$I', t);
    execute format('drop policy if exists p_owner_%1$s on public.%1$I', t);
  end loop;
end $$;

-- profiles：本人看自己；管理员看全部
create policy p_profiles_self on public.profiles
  for all to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

-- cases / intakes：直接按 user_id 隔离
create policy p_cases_owner on public.cases
  for all to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

create policy p_intakes_owner on public.intakes
  for all to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

-- contacts：case_id / intake_id 两条路都校验父归属
create policy p_contacts_owner on public.contacts
  for all to authenticated
  using (
    (case_id is not null    and exists (select 1 from public.cases c    where c.id    = contacts.case_id    and (c.user_id    = auth.uid() or is_admin())))
    or
    (intake_id is not null  and exists (select 1 from public.intakes i  where i.id    = contacts.intake_id  and (i.user_id    = auth.uid() or is_admin())))
  )
  with check (
    (case_id is not null    and exists (select 1 from public.cases c    where c.id    = contacts.case_id    and (c.user_id    = auth.uid() or is_admin())))
    or
    (intake_id is not null  and exists (select 1 from public.intakes i  where i.id    = contacts.intake_id  and (i.user_id    = auth.uid() or is_admin())))
  );

-- timeline / expenses / materials / case_folders：沿 case_id 继承
create policy p_timeline_owner on public.timeline
  for all to authenticated
  using (exists (select 1 from public.cases c where c.id = timeline.case_id and (c.user_id = auth.uid() or is_admin())))
  with check (exists (select 1 from public.cases c where c.id = timeline.case_id and (c.user_id = auth.uid() or is_admin())));

create policy p_expenses_owner on public.expenses
  for all to authenticated
  using (exists (select 1 from public.cases c where c.id = expenses.case_id and (c.user_id = auth.uid() or is_admin())))
  with check (exists (select 1 from public.cases c where c.id = expenses.case_id and (c.user_id = auth.uid() or is_admin())));

create policy p_materials_owner on public.materials
  for all to authenticated
  using (exists (select 1 from public.cases c where c.id = materials.case_id and (c.user_id = auth.uid() or is_admin())))
  with check (exists (select 1 from public.cases c where c.id = materials.case_id and (c.user_id = auth.uid() or is_admin())));

create policy p_case_folders_owner on public.case_folders
  for all to authenticated
  using (exists (select 1 from public.cases c where c.id = case_folders.case_id and (c.user_id = auth.uid() or is_admin())))
  with check (exists (select 1 from public.cases c where c.id = case_folders.case_id and (c.user_id = auth.uid() or is_admin())));

-- vault_meta：每用户只看自己的那一条（id=1 由 unique(user_id) 保证唯一）
create policy p_vault_owner on public.vault_meta
  for all to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

-- ============================================================
-- 管理账号开通（在执行完本文件、用管理邮箱注册成功后，单独跑一句）：
--   update public.profiles set role = 'admin' where email = '管理邮箱@example.com';
-- ============================================================
