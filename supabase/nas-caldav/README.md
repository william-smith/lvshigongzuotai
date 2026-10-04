# NAS 端 CalDAV 服务（Radicale）—— 给手机系统日历原生订阅

## 为什么需要它

- **荣耀/安卓自带日历没有「URL 订阅」入口**：荣耀官方《添加三方账户同步日程》只支持
  账号授权（飞书/钉钉/iCloud）和 **CalDAV 账号**，不支持粘一个 ICS 链接。
- **Outlook 网页版也订阅不了 NAS 的 ICS 地址**：那个域名只有 `:16666` 端口可用，
  80/443 被飞牛自己的 nginx 占着重定向到 5666/5667，微软的抓取器过不来。

CalDAV 是唯一走得通的路：手机系统日历原生支持、提醒百分百响、不依赖任何境外服务。

## 架构

```
手机日历（CalDAV） → https://<你的反代域名:端口>/dav/  →  Lucky(16666)
        → Kong 路由 /dav（带 X-Script-Name: /dav）  →  caldav 容器 :5232
数据：案件表 → calendar_ics() RPC → sync_caldav.py → CalDAV PUT/DELETE
```

## 部署

```bash
cd /vol1/1000/docker/caldav
docker compose build && docker compose up -d
# 首次同步（之后由飞牛「任务计划」每 5 分钟自动跑）
./run_sync.sh
```

`/vol1/1000/docker/caldav/.env`（chmod 600）里存着 CalDAV 账号口令和同步用的密钥。

## 手机端设置（荣耀 MagicOS）

日历 App → 右上角 ⋮ → **设置 → 账户管理 → CalDAV 账号**：

| 项 | 值 |
|---|---|
| 服务器地址 | `https://<你的反代域名:端口>/dav/` |
| 用户名 | `lawyer` |
| 密码 | 见 NAS 上 `/vol1/1000/docker/caldav/.env` 的 `CALDAV_PASS` |

改密码：`vi users`（格式 `用户名:明文口令`）→ `docker compose restart`。

## 定时同步（飞牛「任务计划」App）

新建计划任务：

- **执行周期**：每 5 分钟
- **执行命令**：`/vol1/1000/docker/caldav/run_sync.sh`
- 日志：`/vol1/1000/docker/caldav/sync.log`

> 已刻意不用 crontab（本机 SSH 远程命令偶发被执行两遍，crontab 曾装出重复行）。

## 三个不能改的实现细节

1. **子路径必须带 `X-Script-Name`**：Radicale 挂在 `/dav` 下，Kong 那边要 `strip_path: true`
   并用 `request-transformer` 插件 append `X-Script-Name: /dav`，否则它生成的 href 会丢前缀，
   客户端后续请求全部 404。片段见 `kong-caldav-fragment.yml`。
2. **容器必须接入 `supabase-selfhosted_default` 网络**：否则 Kong 解析不到容器名 `caldav`。
3. **href 要 unquote**：事件 UID 形如 `case-81@lawyer-workbench`，PROPFIND 返回的是
   `case-81%40lawyer-workbench.ics`，比对前必须解码，否则同步脚本会认为事件已消失并全部删除。

## 安全设计

- 同步脚本**只有取到 ≥ MIN_EVENTS 个事件才执行删除**，上游故障不会清空日历；
- Radicale 端口只绑宿主机回环，公网访问必经 Kong 且需 Basic 认证（错密码 401）；
- 容器以 admin(1000:1001) 运行、只读根、`cap_drop: ALL`、日志轮转；
- 内部同步专用订阅 key 已写入 `ical_tokens`（只是普通 token 行，随时可吊销）。

## 回退

```bash
docker compose down
rm -rf /vol1/1000/docker/caldav
# 再删掉 kong.yml 里 - name: caldav 那一段并重启 Kong
```

## 与 cal-ics 的关系

`cal-ics`（`supabase/nas-calendar-svc/`）是把 PostgREST 的 JSON 还原成 ICS 的桥接服务，
本服务上线后它可停可留（当前**保留**，零成本）。两者互不影响。
