# 搭建手册（Setup Guide）

这份文档是**动手开搭**的逐步手册——读完 README 后，按本文一步步把工作台跑起来。

README 写的是「这是什么、能干什么」；本文写的是「选平台 → 建表 → 配 .env → 设口令 → 上锁 → 部署」的逐步操作。

如果你只是路过看仓库，看 [README.md](../README.md) 就够了。

---

## 目录

- 0. 前置准备
- 1. 选云数据库
- 2. 建表（以腾讯云 CloudBase for Supabase 为例）
- 3. 配置 `.env`
- 4. 端到端加密：设主口令
- 5. 登录与权限（部署到公网前必做）
- 6. 部署静态站点
- 7. PWA 安装
- 8. 添加第一个案件
- 9. 常见问题

---

## 0. 前置准备

需要：

- **Node.js 18+**（`node -v` 看版本，推荐 20 LTS）
- **git**
- 一个浏览器（Chrome / Edge / Firefox 均可，建议最新版）
- 一个云数据库账号（下文选）

> ⚠️ 本仓库**不含任何种子数据**。clone 完以后直接打开页面，只有登录框。

```bash
git clone https://github.com/william-smith/lvshigongzuotai.git lawyer-workbench
cd lawyer-workbench
npm install
```

`npm install` 会下载前端依赖（React、Vite、Tailwind 等），体积约 200MB。

打包（可选，本地预览需要）：

```bash
npm run build      # 产物在 dist/，可丢到任意静态托管
npm run dev        # 本地开发服务器（默认 http://localhost:5173）
```

---

## 1. 选云数据库

本仓库对**数据库层零绑定**，只依赖 [PostgREST](https://docs.postgrest.org/) 标准 REST API。下面三家都能用，差异只在「哪儿托管」和「到你这儿的网络延迟」：

| 平台 | 出处 | 优点 | 缺点 | 推荐场景 |
|---|---|---|---|---|
| **Supabase**（海外） | supabase.com | 文档齐全、调试台好用 | 国内访问慢（ap-southeast-2 区域 RTT 200-350ms） | 海外用户 |
| **腾讯云 CloudBase for Supabase**（国内） | cloud.tencent.com | 上海节点 RTT 20-50ms，对国内最快 | 需腾讯云账号 | 国内主用户 |
| **MemFire Cloud**（国内） | memfiredb.com | 文档全、有免费档 | 文档偏轻 | 国内备选 |

> ⚠️ 上面只是**示例**，任何兼容 PostgREST 的服务都可以——只要你的服务能提供 `https://xxx.supabase.co/rest/v1` 风格的 REST URL + `anon` 角色的 API Key 即可。

**最低需要的两个值**（下面会用到）：

- **REST URL**：形如 `https://xxxxx.supabase.co/rest/v1`
- **anon key**：`eyJ...` 开头的长 JWT（对应 `anon` 角色）

去你选的平台控制台开一个项目，拿到这两个值，下一步用。

---

## 2. 建表（以腾讯云 CloudBase for Supabase 为例）

### 2.1 选区域 + 创建项目

平台控制台 → 新建项目 → 选**上海**（国内）→ 等就绪（一般 1-2 分钟）。

### 2.2 跑三段 SQL 创表

平台控制台 → SQL Editor → 新建 Query，依次粘贴并执行：

| 文件 | 作用 |
|---|---|
| `supabase/schema.sql` | 基础 13 张业务表（cases / intakes / timeline / expenses / materials / vault …） |
| `supabase/docs_schema.sql` | 文件分类 + 案件文件夹映射 |
| `supabase/rls_uid_isolation.sql` | 行级安全（RLS）：未登录读不到任何数据 |

三段全跑完，刷新 Tables 应该看到 ~15 张表。

### 2.3 自检

打开 SQL Editor 跑：

```sql
select count(*) from cases;     -- 应该 0（空仓库，不含任何演示数据）
select * from auth.users limit 1;   -- 暂无用户（你注册第一个账号后才有）
```

如果 `cases` 显示 0、没报错，说明表建好了。

---

## 3. 配置 `.env`

仓库根目录有 `.env.example`，**不要改它**——复制成 `.env`：

```bash
cp .env.example .env
```

用编辑器打开 `.env`，填三行（从第 1 步的平台控制台拿）：

```ini
VITE_API_BASE=https://xxxxx.supabase.co/rest/v1
VITE_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...你的 anon key
VITE_GOTRUE_BASE=https://xxxxx.supabase.co/auth/v1
```

- `VITE_API_BASE`：REST 入口（带 `/rest/v1` 后缀）
- `VITE_API_KEY`：**anon 角色的 API key**（不是 service_role！）
- `VITE_GOTRUE_BASE`：GoTrue 认证入口（带 `/auth/v1` 后缀；部分平台如 MemFire 是 `/auth/v1` 同名，可省略此项走默认）

`.env` 已加入 `.gitignore`，不会被提交。

---

## 4. 端到端加密：设主口令

首次打开页面，只有登录框。第一次注册账号后，应用会**立刻弹出设置主口令的对话框**：

- **主口令** = 你保险箱（手机号、身份证、伤情等敏感字段）的唯一钥匙
- 主口令**不在浏览器内持久化**，每次刷新页面都要重新输入
- 加密方式：PBKDF2-SHA256 推导 21 万轮 + AES-256-GCM
- 主口令不能找回——一旦忘了解不开，但普通字段（不敏感）不受影响

### 4.1 建议设置

- 长度 ≥ 12 位（中文也算 1 位）
- 不要用生日、身份证、门牌号
- **找个密码管理器记一份**（推荐 Bitwarden / 1Password）

### 4.2 解锁流程

- 页面打开 → 登录账号 → 设/输入主口令 → 看到「已解锁」状态
- 关闭浏览器 → 主口令清内存 → 下次刷新重新输

### 4.3 换设备 / 忘了口令

- **换设备**：新设备登录账号 + 设相同主口令（或不同），老的已加密字段需重输（设计上故意——服务端无法读取）
- **忘了口令**：没有「找回」按钮。需要用**老口令**重置保险箱内敏感字段，或干脆接受旧敏感字段永远不可见（普通字段照常）

---

## 5. 登录与权限（部署到公网前必做）

部署到公网前，必须开启**行级安全（RLS）**——否则任何人都能读到所有人的数据。

### 5.1 一键开启（推荐）

建表时跑过 `supabase/rls_uid_isolation.sql` 已自动开启 RLS。验证：

```sql
select tablename, rowsecurity
from pg_tables
where schemaname='public'
  and rowsecurity = false;
-- 应该返回 0 行
```

### 5.2 手工（等价 SQL）

如果建表时没跑 RLS 那段 SQL，现在补：

```sql
-- 用 auth.uid() 把每个用户的数据隔离
-- 详细 SQL 见 supabase/rls_uid_isolation.sql
```

### 5.3 验证

1. 注册账号 A → 加几个案件
2. 在隐私窗口登录账号 B
3. 看 B 的案件列表 — 应该是 0
4. 不放心再看一眼：直接拿 anon key curl `cases` 表，应该返回 `[]`

RLS 不到位 = 公网裸奔。

> ⚠️ Supabase / MemFire 控制台里「Legacy API keys」开关**保持开启**——关掉会废掉 anon+service_role，全站 401。

---

## 6. 部署静态站点

`npm run build` 产物在 `dist/`，**纯静态**——丢到任意静态托管都行。

```bash
npm run build          # 输出 dist/
```

下面是几个常用的托管（任选其一）：

### 6.1 Vercel / Netlify / Cloudflare Pages

- 导入这个 GitHub 仓库
- Build command 留空（仓库**预设** `npm run build`），Output dir 填 `dist`
- 环境变量 `VITE_*` 在托管商面板里填（避免写到 `.env.production` 提交）

### 6.2 腾讯云 COS / 阿里云 OSS / 七牛云

- 开静态网站托管，目录指向 `dist/`
- 建议挂 CDN（备案后）

### 6.3 自建 Nginx

```nginx
server {
  listen 80;
  server_name your.domain;
  root /var/www/lawyer-workbench/dist;
  index index.html;

  # PWA: 必须支持 SPA 单页 fallback
  location / { try_files $uri $uri/ /index.html; }
  # 缓存: 静态资源一年,index.html 不缓存
  location ~* \.(js|css|png|svg|webmanifest)$ { expires 1y; }
}
```

⚠️ **SWA（单页 fallback）必须有**——否则刷新非根路径会 404。`try_files` 那行就是干这个的。

---

## 7. PWA 安装

部署完成后，手机浏览器打开 → 浏览器菜单 → **「添加到主屏幕」** → 离线壳可用。

桌面 Chrome/Edge 地址栏右侧会出现「安装」图标，点一下做成桌面 App：

- 离线壳（无网也能打开壳，登录和加解密需要网络）
- 单独窗口、无地址栏
- iOS Safari 16.4+ 也支持

PWA 实现的几个关键点：
- `public/manifest.webmanifest`：名称/图标/主题色
- `public/sw.js`：Service Worker（`vite-plugin-pwa` 未装，手写实现）——同源 JS/CSS/图片 **stale-while-revalidate**，**跨域（数据库）一律不缓存**（敏感数据不出浏览器）
- 首次安装需在线注册 SW；之后离线壳秒开

---

## 8. 添加第一个案件

部署 + 解锁完毕，从首屏点 **「新增案件」**：

| 字段 | 说明 |
|---|---|
| 委托人姓名 | 必填，自动触发 E2E 加密 |
| 案号 | 法院给的（劳动仲裁也属于广义案号） |
| 案由 | 下拉：劳动 / 工伤 / 人损 / 其他 |
| 收案日期 | 用于临期排序 |
| 对方当事人 | 多个用「+」加行 |
| 标的额 | 选填，单位元 |
| 备注 | 选填 |

保存 → 自动跳到案件详情页，可加：

- 时间线（开庭 / 调解 / 文书收到等）
- 费用（开票 / 收付）
- 接案访谈（首次会面摘要）
- 材料登记（指向本机文件，不上传原件）

---

## 9. 常见问题

### Q: 忘了主口令怎么办？
A: 没有「找回」按钮。用**老口令**才能解密已存的敏感字段，新口令可以重设但旧数据开不了。

### Q: 多人能不能共用一个工作台？
A: 每个用户独立账号 + 独立口令。SQL 里按 `auth.uid()` 隔离。

### Q: 备份怎么打？
A: 数据库是你自己选的 Supabase / CloudBase，自带每日快照。**额外建议**：每周导一份全表 JSON 落到本地加密盘。

### Q: 速度很慢？
A: 数据库选国内节点（CloudBase 上海，RTT 20-50ms）；海外节点（悉尼 200-350ms）就别强求秒开了。代码层面 PWA + preconnect + 7 请求并行已做，性能瓶颈在公网 RTT。

### Q: PWA 装不上？
A: 必须 HTTPS（localhost 例外）。检查 `manifest.webmanifest` 是否能 200。

### Q: 不小心把敏感字段暴露了？
A: 立刻改主口令 → 旧密文无法解密（除非有人已经拿到主口令）。日常依赖 RLS + 不暴露 anon key。

---

文档结束。祝搭建顺利。
