# 律师工作台

电脑端和手机端共用的案件管理工具。一套代码、一个网址，手机「添加到主屏幕」就是一个 App。

数据已内置真实案件（**70 件在办案件 · 298 条接案线索 · 119 条时间线 · 20 条费用**），
打开即可用，不需要先建数据库。

---

## 一、马上看效果

```bash
npm install        # 只需一次
npm run dev
```

打开终端里显示的地址（本机 `http://localhost:5173`）。
同一 WiFi 下，手机浏览器打开终端里 `Network:` 那一行（形如 `http://192.168.x.x:5173`）即可同步查看。

想打包后放到静态托管：

```bash
npm run build      # 产物在 dist/
```

---

## 二、手机号是怎么保护的（端到端加密）

这是这套系统最关键的设计，值得先花两分钟理解。

**存了什么**

| 内容 | 存成什么 | 谁能读 |
|---|---|---|
| 委托人、案由、阶段、期限、金额 | 明文 | 任何一端，随时可查 |
| 手机号、身份证 | **密文** + 一份脱敏副本（`150****9528`） | 只有输入过主口令的设备 |
| 伤情、跟踪记录、详细情况 | **密文** + 一份脱敏副本 | 同上 |

**怎么用**

1. 列表默认显示脱敏版（`150****9528`），点 **「解锁查看」**
2. 输入主口令 → 你的设备本地解出完整号码 → 点号码直接拨号
3. 勾了「记住 30 天」，这台设备之后不用重复输入

演示数据的口令是 **`demo-2026`**。输错会直接提示「口令不正确」——
系统用主口令加密了一段固定校验串，解锁时先试着解开它，解不开就说明口令错了，
不会出现「提示成功、但号码全是乱码」的情况。

**密钥去了哪儿**

主口令经 PBKDF2-SHA256（21 万轮）派生出 AES-256 密钥，**只在你的浏览器内存里**。
口令和密钥都不上传服务器。数据库里躺着的只有密文——
就算数据库整个被拖走，拿不到你的主口令，那些号码也只是一堆乱码。

**钥匙丢了怎么办**

- **忘了口令**：数据还在，但号码读不出来。**案号、案由、阶段、期限这些明文数据完全不受影响**，系统照常用
- **换电脑/换手机**：在新设备输入同一个主口令即可（口令相同 → 派生出的密钥相同）
- **务必**：把主口令抄一份纸质的放进保险柜，或存进你的密码管理器

**改主口令**

```bash
# Windows
set VAULT_PASSPHRASE=你的新口令
python scripts/migrate_noco.py          # 用新口令重新加密
python scripts/gen_seed.py              # 重新生成 seed.sql
```

同时把 `.env` 里的 `VITE_DEMO_PASSPHRASE` 改成一样的。

---

## 三、接上真实数据库（可选）

不接也能用——现在跑的就是本地演示数据。接了才能多端实时同步。

**代码不绑定任何厂商**，只依赖 PostgREST 标准接口。下面几家任选其一，
填「接口地址 + 密钥」就能用，换平台不用改一行代码。

| 平台 | 位置 | 免费额度 | 持久性 | 说明 |
|---|---|---|---|---|
| **腾讯云 CloudBase for Supabase 版** | 上海 | 3000 资源点/月 | 免费 6 个月，之后 ¥19.9/月 | **推荐**：大厂、境内合规、中文支持 |
| **MemFire Cloud** | 国内 | 512MB + 1GB 流量/月 | 免费套餐 | 国产 Supabase 架构，想零成本可试 |
| Supabase | 境外 | 500MB | 永久免费 | 连续 7 天无访问会暂停，且数据出境 |

> 当事人姓名是明文存的，放境内机房在合规上更稳妥——这是优先选国内平台的理由。
> 手机号和伤情无论如何都是加密后才写入的，放哪家都一样安全。

### 3.1 腾讯云 CloudBase for Supabase 版（推荐，境内）

**第 1 步 · 建环境**

1. 打开 [云开发控制台](https://tcb.cloud.tencent.com/)，用微信或腾讯云账号登录
2. 新建环境 → **数据库类型务必选 PostgreSQL**（选 MySQL 后面的脚本跑不通）
3. 地域选**上海**（离江苏近，延迟低）

**第 2 步 · 建表**

控制台左侧找 **数据库 / SQL 编辑器** → 新建查询 → 把 `supabase/schema.sql` 的内容整段粘贴进去 → 运行。

跑完应该看到 7 张表：`cases` `intakes` `contacts` `timeline` `expenses` `materials` `vault_meta`。

**第 3 步 · 导数据**

同一个 SQL 编辑器再新建一次查询 → 粘贴 `supabase/seed.sql`（约 810 行）→ 运行。

这一步会写入 70 件案件、298 条线索、223 个加密号码、119 条时间线、20 条费用，外加一行口令校验串。
**整个文件里没有明文手机号**，可以直接核对。

**第 4 步 · 拿接口地址和密钥**

控制台 → 环境 → **连接信息**（有的版本叫「API 密钥」）→ 复制两项：

- **接口地址**：形如 `https://xxxx.ap-shanghai.app.tcloudbase.com`，**后面要手动补 `/rest/v1`**
- **密钥**：anon / publishable 那个（很长一串），**不要复制 service_role 的**

> ⚠️ 地址末尾少了 `/rest/v1` 是最常见的错误，会一直报 404。

**第 5 步 · 填配置**

项目根目录新建文件 `.env`（注意前面有个点）：

```
VITE_API_BASE=https://xxxx.ap-shanghai.app.tcloudbase.com/rest/v1
VITE_API_KEY=eyJhbGciOi...
VITE_DEMO_PASSPHRASE=demo-2026
```

**第 6 步 · 自检**

```bash
npm run check:api
```

会逐表检查并直接告诉你哪里错了：

```
✓ 案件    cases       70 条
✓ 线索    intakes     298 条
✓ 号码    contacts    223 条
...
全部通过 — 重启 npm run dev 即可切到云端数据
```

报错对应的原因：

| 提示 | 原因 |
|---|---|
| HTTP 401 / 403 | 密钥填错，或复制时带了空格／引号 |
| HTTP 404 | 地址末尾少了 `/rest/v1`，或表没建（回第 2 步） |
| 表是空的 0 条 | 表建了但没导数据（回第 3 步） |
| 连不上 | 地址不通，确认环境已启动且能公网访问 |

**第 7 步 · 启动**

```bash
npm run dev
```

侧栏底部显示「元数据已上云」即成功。

> **免费期限**：CloudBase 免费体验版 6 个月，到期前一个月可参与活动 0 元续期（活动到 2026-12-30）。
> 之后个人版 ¥19.9/月。要零成本就切 MemFire 免费层——因为不绑定 SDK，只改这两行配置。

### 3.2 Supabase 原版（境外）

步骤和上面**完全一样**，只有两处不同：

1. 在 [supabase.com](https://supabase.com) 新建项目（免费层永久 $0）
2. 地址和密钥在 **Project Settings → API** 里拿：

```
VITE_API_BASE=https://xxxxx.supabase.co/rest/v1
VITE_API_KEY=eyJhbGciOi...     ← anon public
```

`schema.sql` 和 `seed.sql` 通用，不用改。

> **两个代价**：① 当事人姓名是明文存的，落到境外机房；② 连续 7 天没人访问会自动暂停
> （数据不丢，控制台一键恢复；长期用建议挂个每日心跳保活）。

---

## 四、证据原件怎么同步

**原件不进这个系统。** 扫描件、现场照片、卷宗留在你的电脑和手机上，
用点对点同步工具（如 Verysync）端到端加密直连同步，不经过任何服务器。
工作台只登记「有什么材料、在哪、什么时候更新」。

三个务必注意的点：

1. **原件只有两份副本**（电脑 + 手机）。建议再加密备份一份到对象存储的免费空间（七牛 10GB / Cloudflare R2 10GB）或定期拷移动硬盘
2. **误删会同步**。开启同步工具的版本控制 / 回收站
3. **公网暴露**。客户端要先设用户名密码，密钥单独保管

---

## 五、登录与公网部署

**没做这一步之前，绝对不要把前端部署到公网。** 原因：anon key 会打进前端代码，
任何人打开链接都能拿到它，而旧策略是「持有 key 即可读写」——等于把 70 个案件的姓名案由公开。

做了这一步之后：匿名访问一条数据都读不到，必须先过邮箱密码这关。

### 5.1 一键开启（推荐）

```bash
node scripts/setup_auth.mjs --token sbp_你的token
```

token 在 <https://supabase.com/dashboard/account/tokens> 生成，用完建议 Revoke。
脚本自动做四件事，全部可复查：

1. 建登录账号（邮箱已预验证，不用收确认邮件）
2. **关闭公开注册** ← 关键，否则陌生人能自己注册进来读数据
3. 把 7 张表的 RLS 从「持有 key 即可读写」改成「必须已登录」
4. 复查：用 anon key（未登录）读数据，确认读到 0 条

自定义账号：`--email you@example.com --password 你的密码`

### 5.2 手工开启

1. 控制台 **Authentication → Providers** 打开 Email
2. **Authentication → Sign In** 关闭 *Allow new users to sign up*
3. **Authentication → Users** 手动建用户
4. SQL Editor 执行：

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

### 5.3 登录之后是什么体验

- 打开页面先出登录页；勾「保持登录」后长期不用重复输（存 localStorage，不勾则关掉标签页即失效）
- token 快过期时自动续期，续不上才踢回登录页
- 侧栏底部 / 移动端头像 = 退出登录
- 登录态和加密口令是**两层独立的锁**：没登录读不到数据，没口令解不开号码

### 5.4 验证权限是否真的生效

```bash
npm run check:api                                              # 匿名探测，应全部 0 条
npm run check:api -- --email 你的邮箱 --password 你的密码        # 登录探测，应看到 70/298/223…
```

---

## 六、公网访问与手机装成 App

### 6.1 线上地址

```
https://f4d3ac404c99474991d4a62b180c4788.app.workbuddy.link
```

手机、电脑、任何网络都能打开，**不需要本机开机**——电脑只是开发环境，线上跑的是这个静态托管 + 云端数据库。

首次打开会先出登录页，填：

```
邮箱：lawyer@workbench.local
密码：KaiRui-6406          （改密码走 Supabase 控制台 Authentication → Users）
```

登录后手机号仍是 `150****9528`，点「解锁查看」输入加密口令才显示完整号码。

### 6.2 装成 App

**安卓 / Chrome**：菜单 → **添加到主屏幕** → 从桌面图标进就是全屏，无地址栏。

**iPhone / Safari**：分享 → **添加到主屏幕**。

> 必须用线上地址（https）添加，`localhost` 装不了。

### 6.3 改了代码怎么更新线上

```bash
npm run build && npm run sync:site
```

然后在对话里说一声「发布」，线上版本就会被替换（**链接地址不变**）。

`sync:site` 只把 `dist/` 的构建产物复制到发布目录，源码、`.env`、SQL 脚本都不会被带出去；
如果 `dist/` 里混进了 `.env` 之类的敏感文件，脚本会直接中止。

---

## 七、目录结构

```
lawyer-workbench/
├─ src/
│  ├─ lib/crypto.ts      端到端加密（PBKDF2 + AES-GCM），整个安全模型的地基
│  ├─ lib/auth.tsx       登录（Supabase Auth REST）：登录/登出/自动续期/失效踢出
│  ├─ lib/data.ts        数据层：填了 .env 走云端，否则用本地演示数据
│  ├─ lib/types.ts       数据模型 + 阶段归一化 + 期限计算
│  ├─ store/vault.tsx    密钥状态（解锁 / 锁定 / 记住 30 天）
│  ├─ components/        Icon、导航、解锁弹窗、SecretText（密文展示）
│  └─ pages/             Login（登录）/ Dashboard（临期）/ CaseList（台账）/ CaseDetail（详情）/ MaterialsView
├─ supabase/
│  ├─ schema.sql         建表 + 行级安全（已收紧为「必须已登录」）
│  └─ seed.sql           种子数据（自动生成，无明文手机号）
└─ scripts/
   ├─ migrate_noco.py    从 NocoDB 的 noco.db 迁移并加密
   ├─ gen_seed.py        demo.json → seed.sql
   ├─ deploy_supabase.mjs 建表 + 导数据（Management API）
   ├─ setup_auth.mjs     开登录 + 关注册 + 收紧 RLS
   ├─ check-api.mjs      连通性 / 权限自检
   └─ sync-site.mjs      dist/ → 发布目录（重新发布前跑一次）
```

发布目录是同级目录 `../lawyer-workbench-site/`，里面只有构建产物，用于对外发布。

---

## 八、当前边界

- **已可用**：邮箱登录、案件台账（筛选/搜索/分页/临期）、案件详情（概览/时间线/费用/材料）、端到端加密、响应式布局
- **待建**：新建/编辑案件、材料登记与本机文件夹扫描、归档卷宗、日程与法定期限、工时与收费
- **材料页为空是正常的**：这一版还没接本机材料扫描，页面里写了接法
