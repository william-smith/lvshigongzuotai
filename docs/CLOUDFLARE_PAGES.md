# 公开版部署：Cloudflare Pages + Functions 反代

> 目的：绕过国内对 `*.supabase.co` 的 SNI 拦截。
> 前端与数据层都走**同源** `lawyer-workbench-public.pages.dev`，由 Cloudflare 边缘节点去连 Supabase。

## 目录职责

| 路径 | 作用 |
| --- | --- |
| `functions/api/[[path]].js` | Pages Function：把 `/api/*` 反代到 Supabase（**部署时必须随包上传**） |
| `src/`、`index.html` | 前端源码，构建产物在 `dist/` |
| `.env` | 构建期注入 `VITE_API_BASE` / `VITE_API_KEY`（**不入库**，见 `.gitignore`） |

## 两个必须遵守的点（踩过坑）

1. **`VITE_API_BASE` 必须带 `/rest/v1`**
   ```env
   VITE_API_BASE=https://lawyer-workbench-public.pages.dev/api/rest/v1
   ```
   漏掉 `/rest/v1` 时：数据层 404，但**登录照常能用**（`auth.tsx` 会从 base 里剥掉 `/rest/v1` 再派生出 `/auth/v1`），
   极易误判成「只有数据层坏了」。

2. **部署必须 `cd` 进部署目录再 `pages deploy .`**
   传绝对路径（如 `pages deploy D:/…/dist`）时 wrangler 读不到该目录里的 `functions/`，
   会**静默只发静态资源**，`/api/*` 落到 SPA。判据：日志里必须有
   `✨ Compiled Worker successfully` 与 `✨ Uploading Functions bundle`。

## 部署流程

```bash
# 0) 仓库根目录：构建
npm run typecheck && npm run build          # 产出 dist/

# 1) 同步进「干净部署目录」（只放静态资源 + functions/ + _redirects，勿带 .git 等）
#    部署目录：D:/Documents/workbuddy-public-dist
#    - 覆盖 index.html / sw.js / manifest.webmanifest / icon-* / assets/
#    - functions/ 与 _redirects 就地保留

# 2) 在部署目录内执行（必须清空代理变量，否则 wrangler 会走本地代理卡死）
cd D:/Documents/workbuddy-public-dist
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  CLOUDFLARE_API_TOKEN="<CF token>" \
  CLOUDFLARE_ACCOUNT_ID="<account id>" \
  node <managed-node> <wrangler>/bin/wrangler.js pages deploy . \
  --project-name lawyer-workbench-public --commit-dirty=true
```

- Cloudflare 项目：`lawyer-workbench-public`
- wrangler 入口用 `wrangler/bin/wrangler.js`（`cf-wrangler` 是只认 dev/build 的 shim，别用）

## 🔴 反代铁律：`redirect` 必须是 `manual`

`functions/api/[[path]].js` 里转发的 `fetch` **必须 `redirect: 'manual'` 并原样透传 3xx**，**绝不可 `follow`**。

原因：GoTrue 在「邮箱确认 / 密码找回 / 邀请」流程里，验完 token 会 **302 回 `redirect_to`**，
并把会话放在 **URL fragment**（`#access_token=…&type=recovery`）。代理一旦 follow 掉这个 302，
浏览器只拿到最终的 SPA HTML、**fragment 被丢弃** → 前端读不到会话 →
表现为「点邮件链接后回到登录页、密码没重置」。

自查（应返回 **303** 且 `Location` 带 `#`）：

```bash
curl -s -i --max-redirs 0 \
  "https://lawyer-workbench-public.pages.dev/api/auth/v1/verify?token=bogus&type=recovery&redirect_to=https://lawyer-workbench-public.pages.dev/"
```

## 部署后必做

- Supabase 控制台 → Authentication → URL Configuration：
  - **Site URL** = `https://lawyer-workbench-public.pages.dev/`
  - **Redirect URLs** 增加 `https://lawyer-workbench-public.pages.dev/**`
  （否则邮件回跳会指向旧域名）

## 已知限制

- 数据路径：国内浏览器 → CF 边缘（海外）→ supabase.co（海外）。可用，但**数据经境外节点中转**，合规需评估。
- 未代理 `/realtime/v1`（WebSocket）与 `/storage/v1`：当前工作台都未使用；若启用需补代理。
