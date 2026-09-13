# 律师工作台

电脑端和手机端共用的案件管理工具。**响应式 PWA**：一套代码，手机「添加到主屏幕」即成 App，
电脑浏览器打开直接用。

内置**演示数据**（70 件案件 · 298 条接案线索 · 119 条时间线 · 20 条费用 · 223 个加密号码），
打开即可看效果，不需要先建数据库。

手机号、身份证、伤情等敏感字段一律**端到端加密**入库，主口令永不离开浏览器内存；
即使数据库被拖走，没有口令也只是一堆乱码。

---

## 特性

- **响应式 + PWA**：手机 / 平板 / 电脑一套代码，「添加到主屏幕」离线壳可用
- **端到端加密**（PBKDF2-SHA256 21 万轮 + AES-256-GCM），密钥仅在浏览器内存
- **数据层零绑定**：只依赖 PostgREST 标准 REST，可切换 腾讯云 CloudBase / MemFire / Supabase，
  换平台改两行配置
- **行级安全（RLS）**：未登录读不到任何数据
- **证据原件不上云**：本机 + Verysync 端到端直连，工作台只登记索引
- **案件台账 + 临期提醒 + 详情 + 时间线 + 费用 + 材料登记**
- **手机号始终脱敏展示**（`150****9528`），解锁后显示完整号码并可一键拨号

---

## 快速开始

```bash
npm install        # 一次
npm run dev        # 打开终端里的地址（默认 http://localhost:5173）
```

同一 WiFi 下，手机浏览器访问终端 `Network:` 那一行（形如 `http://192.168.x.x:5173`）
即可同步查看。

打包：

```bash
npm run build      # 产物在 dist/，可丢到任意静态托管
```

---

## 一、数据是怎么保护的（端到端加密）

**存了什么**

| 内容 | 存储形态 | 谁能读 |
|---|---|---|
| 委托人、案号、案由、阶段、期限、金额 | 明文 | 任何一端，随时可查 |
| 手机号、身份证 | **密文** + 脱敏副本（`150****9528`） | 输入过主口令的设备 |
| 伤情、跟踪记录、详细情况 | **密文** + 脱敏副本 | 同上 |

**怎么用**

1. 列表默认显示脱敏版，点 **「解锁查看」**
2. 输入主口令 → 本地解出完整号码 → 点号码直接拨号
3. 勾「记住 30 天」，这台设备后续不用重输

演示数据的解锁口令是 `demo-2026`（在 `.env.example` 里改）。
输错会直接提示「口令不正确」——系统用主口令加密了一段固定校验串，
解开试一下，解不开就是口令错，不会出现「看似成功、号码全是乱码」的情况。

**密钥去了哪儿**

主口令经 PBKDF2-SHA256（21 万轮）派生出 AES-256 密钥，**只在你的浏览器内存里**。
口令和密钥都不上传服务器。数据库里躺着的只有密文。

**钥匙丢了怎么办**

- **忘了口令**：号码解不开，但案号 / 案由 / 阶段 / 期限等明文数据完全不受影响，系统照常用
- **换电脑/换手机**：在新设备输入同一个主口令即可（口令相同 → 派生密钥相同）
- **务必**：把主口令抄一份纸质的放进保险柜，或存进密码管理器

---

## 二、接上真实数据库（可选）

不接也能用——跑的就是本地演示数据。接了才能多端实时同步。

**代码不绑定任何厂商**，只依赖 PostgREST 标准接口。下面几家任选其一，
填「接口地址 + 密钥」即可，换平台不用改一行代码。

| 平台 | 位置 | 免费额度 | 持久性 |
|---|---|---|---|
| **腾讯云 CloudBase for Supabase 版**（推荐） | 上海 | 3000 资源点/月 | 免费体验期，到期后个人版按量计费 |
| **MemFire Cloud**（国产 Supabase 架构） | 国内 | 512MB + 1GB 流量/月 | 免费套餐 |
| Supabase 原版 | 境外 | 500MB | 永久免费（连续 7 天无访问会暂停） |

> 当事人姓名是明文存的，放境内机房在合规上更稳妥。
> 手机号和伤情无论如何都是加密后才写入的，放哪家都一样安全。

### 通用三步

**1. 建环境**（任选一家，按其控制台指引新建 PostgreSQL 项目，地域建议上海/国内）

**2. 建表 + 导数据**：控制台 SQL 编辑器依次执行

- `supabase/schema.sql` —— 建 7 张表（`cases` `intakes` `contacts` `timeline` `expenses` `materials` `vault_meta`）
- `supabase/seed.sql` —— 写入演示数据（约 810 行；**整段无明文手机号**，可直接核对）

**3. 拿地址 + 密钥**：控制台 → API / 连接信息

```
VITE_API_BASE=https://你的域名/rest/v1
VITE_API_KEY=你的 anon / publishable 密钥     ← 不要复制 service_role
VITE_DEMO_PASSPHRASE=demo-2026
```

填到项目根目录的 `.env`（前面有个点，从 `.env.example` 复制改名即可）。

> ⚠️ 地址末尾少了 `/rest/v1` 是最常见的 404 错误。

**自检**

```bash
npm run check:api
```

会逐表检查并直接告诉你哪里错了（401 密钥错 / 404 缺 `/rest/v1` / 0 条没导数据 / 连不上）。

---

## 三、证据原件怎么同步

**原件不进这个系统。** 扫描件、现场照片、卷宗留在你的电脑和手机，
用点对点同步工具（如 Verysync）端到端加密直连，不经过任何服务器。
工作台只登记「有什么材料、在哪、什么时候更新」。

三个务必注意的点：

1. **原件只有两份副本**（电脑 + 手机）。建议再加密备份一份到对象存储的免费空间
   （七牛 10GB / Cloudflare R2 10GB）或定期拷移动硬盘
2. **误删会同步**。开启同步工具的版本控制 / 回收站
3. **公网暴露**。客户端先设用户名密码，密钥单独保管

---

## 四、登录与权限（部署到公网前必做）

**没做这一步之前，绝对不要把前端部署到公网。**
anon key 会打进前端代码，部署后任何人打开链接都能拿到它——
而默认策略是「持有 key 即可读写」，等于把案件数据公开。

做了这一步之后：匿名访问一条数据都读不到，必须先过邮箱密码这关。

### 一键开启

```bash
node scripts/setup_auth.mjs --token sbp_你的token
```

token 在对应云平台的控制台「Personal access tokens」生成，用完建议 Revoke。
脚本自动做四件事，全部可复查：

1. 建登录账号（邮箱已预验证，不用收确认邮件）
2. **关闭公开注册** ← 关键，否则陌生人能自己注册进来读数据
3. 把 7 张表的 RLS 从「持有 key 即可读写」改成「必须已登录」
4. 复查：用 anon key（未登录）读数据，确认读到 0 条

自定义账号：`--email you@example.com --password 你的密码`

### 手工开启（等价的 SQL）

```sql
do $$
declare t text;
begin
  foreach t in array array['cases','intakes','contacts','timeline','expenses','materials','vault_meta']
  loop
    execute format('drop policy if exists p_all_%1$s on public.%1$I', t);
    execute format('create policy p_auth_%1$s on public.%1$I for all to authenticated using (auth.role() = %2$L) with check (auth.role() = %2$L)', t, 'authenticated');
  end loop;
end $$;
```

### 登录体验

- 打开页面先出登录页；勾「保持登录」长期免输（存 localStorage）
- token 快过期自动续期，续不上才踢回登录页
- 登录态 ≠ 加密口令：没登录读不到数据，没口令解不开号码（两层独立）

### 验证权限

```bash
npm run check:api                                              # 匿名探测，应全部 0 条
npm run check:api -- --email 你的邮箱 --password 你的密码        # 登录探测，应看到完整数据
```

---

## 五、部署为静态站点

`npm run build` 产出在 `dist/`，可以丢到**任何静态托管**（Vercel / Netlify /
GitHub Pages / Cloudflare Pages / 对象存储 + CDN 等）。

**前端构建包里没有 `service_role` 密钥、没有 `.env`**（Vite 只注入 `VITE_` 前缀变量），
但 `anon` 密钥会被打进 JS——所以**部署到公网前必须完成「四、登录与权限」**。

### 装成 App（PWA）

- **安卓（Chrome / Edge）**：菜单 → **添加到主屏幕**
- **iPhone（Safari）**：分享 → **添加到主屏幕**

> 必须用 `https://` 地址添加，`localhost` 装不了。

---

## 六、目录结构

```
lawyer-workbench/
├─ src/
│  ├─ lib/crypto.ts        端到端加密（PBKDF2 + AES-GCM），整个安全模型的地基
│  ├─ lib/auth.tsx         登录态、自动续期、失效踢出
│  ├─ lib/data.ts          数据层：填了 .env 走云端，否则用本地演示数据
│  ├─ lib/types.ts         数据模型 + 阶段归一化 + 期限计算
│  ├─ store/vault.tsx      密钥状态（解锁 / 锁定 / 记住 30 天）
│  ├─ components/          Icon、导航、解锁弹窗、SecretText（密文展示）
│  └─ pages/               Login / Dashboard（临期）/ CaseList / CaseDetail / MaterialsView ...
├─ supabase/
│  ├─ schema.sql           建表 + 行级安全
│  └─ seed.sql             演示数据（自动生成，无明文手机号）
├─ public/                 PWA 图标、manifest、Service Worker
└─ scripts/
   ├─ migrate_noco.py      从 NocoDB 的 noco.db 迁移并加密
   ├─ gen_seed.py          demo.json → seed.sql
   ├─ deploy_supabase.mjs  建表 + 导数据（Management API）
   ├─ setup_auth.mjs       开登录 + 关闭注册 + 收紧 RLS
   ├─ check-api.mjs        连通性 / 权限自检
   └─ sync-site.mjs        dist/ → 发布目录
```

---

## 七、当前状态

- **已可用**：邮箱登录、案件台账（筛选/搜索/分页/临期）、案件详情（概览/时间线/费用/材料）、
  端到端加密、响应式布局、PWA
- **进行中**：本机材料扫描与案件目录配对、手机端目录授权、Android Edge 适配
- **规划**：新建/编辑案件 UI、归档卷宗、日程与法定期限、工时与收费

---

## License

未指定。如需使用请联系作者。