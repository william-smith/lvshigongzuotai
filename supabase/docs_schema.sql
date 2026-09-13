-- ============================================================
-- 文书与证据（8 分类索引 + 案件文件夹绑定）
--
-- 设计前提：
--   1. 证据原件只存本机 + 手机，Verysync 点对点加密同步，绝不上传云端。
--      本文件只建「索引」表——文件名、大小、分类、相对路径，不含文件内容。
--   2. 电脑端（Chrome/Edge）通过 File System Access API 授权同步根目录后，
--      浏览器本地枚举 + 本地读取原图直接渲染，文件字节不出本机。
--   3. 手机端（无此 API）只读云端索引：看清单、改分类、复制手机路径，
--      看图走 Verysync / 文件管理器。
--   4. 路径存 rel_path（相对案件文件夹），设备无关：
--      PC 完整路径   = case_folders.pc_folder     + rel_path
--      手机完整路径  = case_folders.mobile_folder + rel_path
--
-- 用法： Supabase 控制台 → SQL Editor → 粘贴执行（可重复执行，用了 if not exists）
-- ============================================================

-- ---------- 1. 扩展 materials 为「文件索引」 ----------
alter table public.materials add column if not exists rel_path      text;
alter table public.materials add column if not exists category      smallint default 0;
alter table public.materials add column if not exists category_src  text default 'auto';
alter table public.materials add column if not exists indexed_at    timestamptz default now();

-- category: 0 未分类 | 1-8 见 docCategory.ts
-- category_src: 'auto' 关键词自动归类 | 'manual' 手动改判（手动优先，不被自动覆盖）
comment on column public.materials.category is
  '0未分类 1法院仲裁委文件 2对方证据及文书 3我方证据及文书 4法律法规案例参考论文 5委托授权材料 6与客户沟通文件会议纪要 7保全 8执行';
comment on column public.materials.rel_path is '相对案件文件夹的路径，设备无关，用于拼接 PC / 手机各自的根目录';

-- 同一案件下同一相对路径只留一条
create unique index if not exists uq_materials_case_rel
  on public.materials (case_id, rel_path)
  where rel_path is not null;

create index if not exists idx_materials_category on public.materials (case_id, category);

-- ---------- 2. 案件 ↔ 同步文件夹绑定（PC / 手机两条路径，都可改） ----------
create table if not exists public.case_folders (
  id             bigserial primary key,
  case_id        bigint not null references public.cases(id) on delete cascade,
  folder_name    text,                 -- 同步根目录下的文件夹名（通常≈委托人）
  pc_folder      text,                 -- 电脑端绝对路径
  mobile_folder  text,                 -- 手机端绝对路径
  matched_by     text default 'auto',  -- auto 自动匹配 | manual 手动指定
  updated_at     timestamptz default now()
);
create unique index if not exists uq_case_folders_case on public.case_folders (case_id);
create index if not exists idx_case_folders_name on public.case_folders (folder_name);

alter table public.case_folders enable row level security;

-- 与既有 7 张表同一条策略：只有已登录用户能读写，anon key 一条都拿不到
do $$
begin
  execute format('drop policy if exists p_auth_%1$s on public.%1$I', 'case_folders');
  execute format('drop policy if exists p_all_%1$s on public.%1$I', 'case_folders');
  execute format(
    'create policy p_auth_%1$s on public.%1$I for all to authenticated using (auth.role() = %2$L) with check (auth.role() = %2$L)',
    'case_folders', 'authenticated');
end $$;
