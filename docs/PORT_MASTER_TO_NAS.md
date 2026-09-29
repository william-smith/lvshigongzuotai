# 公开版(master) → NAS 版(nas-selfhost) 移植清单

生成时间：2026-09-28
merge-base：`eed20e6`（两侧从此处分叉）
master 独有 commit：**13 个**；两侧自 merge-base 改过的文件：master 28 个 / NAS 21 个 / **两边都改过 14 个（=冲突）**

---

## 一、逐 commit 清单

| # | commit | 摘要 | 涉及文件 | 冲突 | 建议 |
|---|--------|------|---------|------|------|
| 1 | `816bb38` | 弃用 Vercel→CF Pages；清理旧副本 | README、docs/SETUP、scripts/sync-site.mjs、删 vercel.json | 无 | ❌ **不搬**（公开部署专用，含云端地址） |
| 2 | `cba2572` | CF Pages 反代入库 | docs/CLOUDFLARE_PAGES.md、`functions/api/[[path]].js` | 无 | ❌ **不搬**（公开版反代，内含 cloud supabase ref） |
| 3 | `a0d8b78` | 去掉案件台账写死「承办」列；头像用登录律师姓名首字 | CaseList.tsx、Dashboard.tsx | **零冲突** | ✅ **优先搬** |
| 4 | `c3fed20` | 保险箱就绪才保存（避免只存打码版丢原文） | CaseEditor、ExpenseEditor⚠️、IntakeEditor、TimelineEditor、store/vault.tsx | 仅 ExpenseEditor | ✅ **搬**，ExpenseEditor 手工合 |
| 5 | `d2fbcfe` | 找回密码闭环（ResetPassword 页 + Login forgot + hash 会话） | App.tsx⚠️、Login.tsx（安全）、ResetPassword.tsx（新增，安全） | 仅 App.tsx | ✅ **搬**，路由部分手工加 |
| 6 | `685ef3b` | 律师姓名/律所名自行填写（user_metadata）；Nav 动态显示；Settings 律师信息卡 | Nav.tsx⚠️、auth.tsx⚠️、Settings.tsx⚠️ | **三个全冲突** | ⚠️ **手工移植**（auth.tsx 最危险，见下文） |
| 7 | `2953daa` | 多租户：注册/邮箱验证 + user_id 行级隔离 + 库自增 id | auth⚠️、caseOps⚠️、expenseOps⚠️、intakeOps⚠️、timelineOps⚠️、Login(安全)、+multitenant_schema.sql、+vercel.json | **最重** | 🔶 **暂缓**（需同步迁移 NAS 库 schema） |
| 8 | `5f97f98` | 15s 超时 + 中文网络错误 | auth.tsx⚠️ | auth.tsx | ❌ **不搬**，NAS 侧已有等价 `b4e14b8`（含 resolveApi 版） |
| 9 | `27a40f5` | 移动端手势 / 双面板交叉滑动 | App⚠️、index.css⚠️、gestures.ts⚠️、CaseDetail⚠️ | **四个全冲突** | ❌ **不搬**，NAS 侧已修正更多（见下文） |
| 10 | `4ae00f8` | 刷新后保留当前界面 | App.tsx⚠️ | App.tsx | ❌ **不搬**，NAS 已有 `ace128d` |
| 11 | `55e588a` | 底部 tab 横滑切换 + 方向动画 | App⚠️、Nav⚠️、index.css⚠️ | **全冲突** | ❌ **不搬**，NAS 已有 `1890759` |
| 12 | `e666175` | 设置三分区 + 账号徽标 + user 图标（**不含 NAS 数据源分区**） | Icon.tsx⚠️、Settings.tsx⚠️ | 冲突 | ❌ **不搬**，NAS 已有 `9fa58c0` 且**含数据源分区**（master 版缺这块） |
| 13 | `3d0ac78` | gitignore 忽略本地 NAS 配置 | .gitignore | 两边都改 | ⚪ 按需手工合并 NAS 忽略项 |

图例：✅ 建议搬 ｜ ⚠️ 需手工移植 ｜ ❌ 不建议搬 ｜ 🔶 待决策 ｜ ⚪ 可忽略

---

## 二、为什么第 9/10/11/12 号不该搬（关键）

这两条分支**不是「master 领先」**，而是**各自并行实现**了同类功能，NAS 侧还更完善：

| 功能 | master 侧 | NAS 侧（更多修正） |
|------|-----------|-------------------|
| 底部 tab 横滑 | `55e588a` | `1890759` + 后续 6 个方向/误判修正 |
| 详情页手势 | `27a40f5` | `289a45e`→`db7e740`→`10aacfb`→`52b5141`→`d7098d9`→`2817efc`→`9182eb7`→`d0de740`（修掉了左右反了、手势分区误判） |
| 刷新保留界面 | `4ae00f8` | `ace128d` |
| 设置美化 | `e666175`（**无**数据源分区） | `9fa58c0`（**有**数据源分区） |

强行搬 master 的旧版会**覆盖掉 NAS 侧已修好的手势**。这些是把公开版往 NAS 搬时最容易踩的坑。

---

## 三、14 个冲突文件 · 按风险分级

**🔴 高危（绝不能整文件覆盖）**
- `src/lib/auth.tsx` — master 用 `import.meta.env.VITE_API_BASE`，NAS 用 `resolveApi()` 支持运行时切后端。**整文件替换会直接干掉 NAS 的后端切换能力**（既有教训）。搬时必须只取函数增量。

**🟠 中（串行改同一块 UI）**
- `src/App.tsx`（找回密码路由 + 手势）、`src/pages/Settings.tsx`（律师信息卡 vs NAS 数据源分区）、`src/components/Nav.tsx`（姓名显示 vs 已移除的归档卷宗项）

**🟡 低-中**
- `src/lib/caseOps.ts` / `intakeOps.ts` / `timelineOps.ts` / `expenseOps.ts`（多租户改造 vs NAS 同步/加密改动）
- `src/index.css` / `src/lib/gestures.ts` / `src/pages/CaseDetail.tsx`（动画，建议保留 NAS 版）
- `src/components/Icon.tsx`（两侧各加了 user 图标）
- `src/pages/ExpenseEditor.tsx`（保险箱修复 vs 费用密文相关）

**🟢 无冲突（master 独有，NAS 从未改）**
`CaseList.tsx`、`Dashboard.tsx`、`CaseEditor.tsx`、`IntakeEditor.tsx`、`TimelineEditor.tsx`、`store/vault.tsx`、`Login.tsx`、`ResetPassword.tsx`(新增)、`supabase/multitenant_schema.sql`(新增)

---

## 四、建议分批执行

- **批次 A（低风险，可直接cherry-pick）**：`#3 a0d8b78`、`#4 c3fed20`（ExpenseEditor 手工）、`#5 d2fbcfe`（Login+ResetPassword 直取，App.tsx 手写路由）
- **批次 B（手工移植）**：`#6 685ef3b` — Nav / Settings 取 UI，auth.tsx 只加 `fetchProfile/saveProfileRemote` 两个函数，保留 NAS 的 `resolveApi`
- **批次 C（待你决策）**：`#7 2953daa` 多租户 — 若要，需先在 NAS 自建库执行 schema 迁移（user_id 列 / identity 主键 / profiles 表 / RLS / 邮箱验证）

---

## 五、你的三个决定 · 落地点

### 1）`role = nas` 才显示 NAS 相关功能
NAS 分支**目前完全没有 profiles / role 概念**（已核实无任何相关文件），需要新建判定。落地点：
- `src/lib/auth.tsx` — 读取并暴露当前用户 role
- `src/pages/Settings.tsx` — 「数据源」分区按 role 显示/隐藏
- `src/App.tsx` / `src/components/Nav.tsx` — 同步入口是否挂载

role 来源建议（NAS 自建库可直接 SQL 打标，无需改表结构）：
```sql
-- 在 NAS 自建 Supabase 给指定账号打上 nas 角色
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"nas"}'::jsonb
where email = 'william-smith@live.cn';
```
前端从登录后的 access_token（app_metadata）读 `role`，命中 `nas` 才渲染 NAS 功能区。

### 2）NAS 反代网址由用户自填
✅ **机制本来就是这样**：用户在「设置→数据源」自行填写，存 localStorage（`lw.backend.v2`），`apiConfig.ts` 里**没有任何硬编码域名**。

仅需清理一处：
- `src/components/DataSync.tsx:106` — 输入框的 `placeholder` 直接写死了你的真实地址：
  ```
  placeholder="https://sbp.coolvia.de5.net:16666/rest/v1"
  ```
  改为通用提示（如 `https://你的反代域名/rest/v1`）即可，产物中不再出现私人地址。

### 3）注意：前端隐藏 ≠ 访问控制
即使非 nas 角色看不到入口，静态产物仍可被翻看。真正的防线仍在服务端：NAS 自建 Supabase 的 GoTrue 鉴权 + RLS（现状已是「登录后可见全部行」）。若后续要严格，可考虑 §Q3 那种动态 import 分包，让非授权账号根本下载不到这段代码。
