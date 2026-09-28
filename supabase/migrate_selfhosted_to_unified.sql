-- ============================================================================
-- 自建库「原地迁移」到统一结构（保留现有数据）
--
-- 适用：你已经有一个自建 Supabase（旧结构：无 user_id、主键由客户端生成），
--       现在要让它兼容统一版应用（多租户结构：user_id + 库自增主键 + RLS）。
--
-- 设计取舍（请先看这三条）：
--   1. 主键用 GENERATED **BY DEFAULT** AS IDENTITY，而不是目标 schema 的 ALWAYS。
--      原因：BY DEFAULT 允许显式插入 id，你将来用备份 JSON 回灌历史数据时不会被拒；
--      应用本身不传 id（由库生成），两者都成立。
--   2. user_id 用你自己的账号 uid 回填所有历史行（自建库本来就是你一个人在用）。
--   3. RLS 全表开启 + 按 user_id 隔离。开启后 anon key 单独拿不到任何数据，
--      必须登录；而登录后若 user_id 不是自己的，同样看不到——这正是多租户隔离。
--
-- ⚠️ 执行前必做：整库备份（pg_dump），并确认应用当前没人正在写入。
--
-- 用法：
--   1) 把下面「第 2 步」里的 owner_email 改成你自己的登录邮箱；
--   2) 在自建库执行本文件（Supabase SQL Editor / psql / Adminer 均可）；
--   3) 跑完看最后「自检」一节的输出是否符合预期。
--
-- 如何查自己的 uid（改完邮箱后可先跑这句确认账号存在）：
--   select id, email from auth.users order by created_at;
-- ============================================================================


-- ---------- 第 1 步：profiles 表 + 注册触发器 + is_admin() ----------
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'user',   -- 'user' | 'admin' | 'nas'
  created_at timestamptz default now()
);
create index if not exists idx_profiles_role on public.profiles (role);

-- 注册即建档
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

-- 为已有账号补建 profiles（触发器只管新用户，历史账号要手工补）
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do nothing;

-- 管理员判定（SECURITY DEFINER 绕开 RLS 读 profiles）
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


-- ---------- 第 2 步：给根表加 user_id，并把历史数据归到你名下 ----------
-- ⚠️ 把下面这行的邮箱改成你自己的登录邮箱（必须已存在于 auth.users）
do $$
declare
  owner_email text := '你的邮箱@example.com';
  owner_uid   uuid;
begin
  select id into owner_uid from auth.users where email = owner_email limit 1;
  if owner_uid is null then
    raise exception '未找到邮箱 % 对应的账号，请先确认邮箱或先注册该账号', owner_email;
  end if;
  raise notice '归属账号 uid = %', owner_uid;

  -- cases
  alter table public.cases   add column if not exists user_id uuid;
  update public.cases   set user_id = owner_uid where user_id is null;
  alter table public.cases   alter column user_id set default auth.uid();
  alter table public.cases   alter column user_id set not null;

  -- intakes
  alter table public.intakes add column if not exists user_id uuid;
  update public.intakes set user_id = owner_uid where user_id is null;
  alter table public.intakes alter column user_id set default auth.uid();
  alter table public.intakes alter column user_id set not null;

  -- vault_meta（每用户一条）
  alter table public.vault_meta add column if not exists user_id uuid;
  update public.vault_meta set user_id = owner_uid where user_id is null;
  alter table public.vault_meta alter column user_id set default auth.uid();
  alter table public.vault_meta alter column user_id set not null;

  raise notice 'user_id 回填完成';
end $$;

create index if not exists idx_cases_user   on public.cases (user_id);
create index if not exists idx_intakes_user on public.intakes (user_id);
create index if not exists idx_vault_user   on public.vault_meta (user_id);

-- vault_meta 的「每用户一条」唯一约束（若你库里已有重复 user_id，这句会失败，
-- 属正常——先去重再补；单用户自建库通常是 1 行，不会有问题）
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vault_meta'::regclass and contype = 'u'
      and conkey @> (array[(select attnum from pg_attribute
                            where attrelid='public.vault_meta'::regclass and attname='user_id')])::smallint[]
  ) then
    alter table public.vault_meta add constraint vault_meta_user_unique unique (user_id);
  end if;
exception when others then
  raise notice 'vault_meta 唯一约束未添加（可能已存在或数据有重复）：%', sqlerrm;
end $$;


-- ---------- 第 3 步：主键改为库自增（identity），并把序列对齐到现有最大值 ----------
do $$
declare
  t   text;
  seq text;
  mx  bigint;
begin
  foreach t in array array['cases','intakes','timeline','expenses','contacts','materials','case_folders']
  loop
    -- 表或 id 列不存在则跳过（不同版本的表集合可能略有差异）
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='id'
    ) then
      raise notice '跳过 %（无 id 列）', t;
      continue;
    end if;

    -- 仅在 id 还没有默认值时添加 identity，避免重复执行报错
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='id'
        and column_default is null
        and data_type in ('bigint','integer','smallint')
    ) then
      execute format('alter table public.%I alter column id add generated by default as identity', t);
      raise notice '%：已添加 identity', t;
    else
      raise notice '%：id 已有默认值，跳过', t;
    end if;

    -- 序列对齐到 max(id)+1，否则新插入会撞已有主键
    seq := pg_get_serial_sequence(format('public.%I', t), 'id');
    if seq is not null then
      execute format('select coalesce(max(id),0) from public.%I', t) into mx;
      perform setval(seq, mx + 1, false);
      raise notice '%：序列已对齐到 %', t, mx + 1;
    end if;
  end loop;
end $$;


-- ---------- 第 4 步：开启 RLS + 按归属隔离 ----------
alter table public.profiles     enable row level security;
alter table public.cases        enable row level security;
alter table public.intakes      enable row level security;
alter table public.contacts     enable row level security;
alter table public.timeline     enable row level security;
alter table public.expenses     enable row level security;
alter table public.materials    enable row level security;
alter table public.case_folders enable row level security;
alter table public.vault_meta   enable row level security;

-- 清掉旧的全放行策略，避免叠加后等于没隔离
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

drop policy if exists p_profiles_self       on public.profiles;
drop policy if exists p_cases_owner         on public.cases;
drop policy if exists p_intakes_owner       on public.intakes;
drop policy if exists p_contacts_owner      on public.contacts;
drop policy if exists p_timeline_owner      on public.timeline;
drop policy if exists p_expenses_owner      on public.expenses;
drop policy if exists p_materials_owner     on public.materials;
drop policy if exists p_case_folders_owner  on public.case_folders;
drop policy if exists p_vault_owner         on public.vault_meta;

create policy p_profiles_self on public.profiles
  for all to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

create policy p_cases_owner on public.cases
  for all to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

create policy p_intakes_owner on public.intakes
  for all to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());

create policy p_contacts_owner on public.contacts
  for all to authenticated
  using (
    (case_id is not null   and exists (select 1 from public.cases c   where c.id = contacts.case_id   and (c.user_id = auth.uid() or is_admin())))
    or
    (intake_id is not null and exists (select 1 from public.intakes i where i.id = contacts.intake_id and (i.user_id = auth.uid() or is_admin())))
  )
  with check (
    (case_id is not null   and exists (select 1 from public.cases c   where c.id = contacts.case_id   and (c.user_id = auth.uid() or is_admin())))
    or
    (intake_id is not null and exists (select 1 from public.intakes i where i.id = contacts.intake_id and (i.user_id = auth.uid() or is_admin())))
  );

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

create policy p_vault_owner on public.vault_meta
  for all to authenticated
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());


-- ---------- 第 5 步：给你的账号打上 nas 角色 ----------
-- 应用据此显示「数据源」分区（可切到自建库）。角色写在 JWT 的 app_metadata 里，
-- 打标后需要**重新登录**才会出现在新的 access_token 中。
do $$
declare
  owner_email text := '你的邮箱@example.com';   -- ⚠️ 同样改成你的邮箱
begin
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"nas"}'::jsonb
  where email = owner_email;

  update public.profiles set role = 'nas' where email = owner_email;
  raise notice '已为 % 打上 nas 角色（请重新登录生效）', owner_email;
end $$;


-- ============================================================================
-- 自检（逐条跑，确认符合预期）
-- ============================================================================

-- 1) 历史数据是否都已归属（应为 0）
-- select count(*) as 未归属案件 from public.cases where user_id is null;
-- select count(*) as 未归属线索 from public.intakes where user_id is null;

-- 2) RLS 是否全部开启（relrowsecurity 应全为 t）
-- select relname, relrowsecurity from pg_class
-- where relnamespace='public'::regnamespace and relkind='r' order by relname;

-- 3) 主键是否已为 identity（应看到 identity 相关默认值）
-- select table_name, column_default from information_schema.columns
-- where table_schema='public' and column_name='id'
--   and table_name in ('cases','intakes','timeline','expenses')
-- order by table_name;

-- 4) 角色是否打上（app_metadata 里应有 "role":"nas"）
-- select id, email, raw_app_meta_data from auth.users;
-- select id, email, role from public.profiles;
