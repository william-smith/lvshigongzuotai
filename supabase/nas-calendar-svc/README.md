# NAS 日历订阅桥接服务（cal-ics）

把 NAS 自建 Supabase 的案件到期日历，变成 Outlook / iOS / Google 日历能直接订阅的地址。

## 为什么需要这一层

PostgREST 的标量 RPC `calendar_ics(key)` 有两个硬限制：

1. 返回体是 **JSON 包裹的字符串**（`"...VCALENDAR..."`），`Content-Type: application/json`；
2. 对 `Accept: text/calendar` / `text/plain` 一律返 **406 PGRST107** —— 无法内容协商。

而日历客户端只会发 `GET` + `Accept: text/calendar`，也不会带 `apikey` 头。
所以：`https://…/rest/v1/rpc/calendar_ics?key=xxx` 在 Outlook 里必然订阅失败（401 或 406）。

本服务负责三件事：代打 service_role 鉴权 → `json.loads` 拆包裹 → 以 `text/calendar` 输出。

## 部署

```bash
mkdir -p /vol1/1000/docker/calendar-svc
# 放入 cal_serve.py / docker-compose.yml，然后：
printf 'CAL_SERVICE_ROLE_KEY=< Supabase .env 里的 SERVICE_ROLE_KEY >\n' > .env
chmod 600 .env
docker compose up -d
docker compose logs -f
```

### ⚠️ Docker Hub 不通（国内 NAS 常见）

NAS 直连 `registry-1.docker.io` 会超时（HTTP 000），`docker compose up -d` 会卡死在拉取阶段。
解决办法：先从国内源拉下来再改名成 compose 里写的 tag，**不需要改 daemon.json、不需要 root**：

```bash
docker pull docker.m.daocloud.io/library/python:3.12-alpine     # 实测可用
docker tag  docker.m.daocloud.io/library/python:3.12-alpine python:3.12-alpine
docker compose up -d
```

（备用源：`docker.1ms.run`、`ccr.ccs.tencentyun.com`、`registry.cn-hangzhou.aliyuncs.com`，
可用性判断：`curl -o /dev/null -w "%{http_code}" https://<源>/v2/` 返回 401 即为在线。）

### ⚠️ 别用 printf 直接往 kong.yml 里写多行

远程 shell 里 `printf "...\n..."` 的反斜杠转义会被 mangled（`\n` 会变成字面 `/n`），
写坏后 Kong 会 `error parsing declarative config file` 直接起不来（整个自建库入口中断）。
正确做法：**先落文件再 `cat >>`**，并且重启前先跑一次 YAML 校验。

内网自测（应返回 `200` + `text/calendar` + 明文 `BEGIN:VCALENDAR`）：

```bash
curl -si "http://127.0.0.1:8899/calendar.ics?key=<你的订阅key>"
curl -si "http://127.0.0.1:8899/healthz"      # -> ok
```

## 对外发布（Lucky）

在 `<你的反代域名:端口>` 的 HTTPS 反向代理站点里 **新增一条子路径规则**：

| 项 | 值 |
|---|---|
| 前端地址 / 域名 | `<你的反代域名>` |
| 前端路径 | `/calendar.ics` |
| 后端地址 | `http://127.0.0.1:8899` |
| 后端路径 | `/calendar.ics`（留空亦可） |

原有 `/` 规则不动。删掉这条规则即回退。

公网验证：

```bash
curl -si "https://<你的反代域名:端口>/calendar.ics?key=<你的订阅key>"
```

## 前端

`src/lib/ical.ts` 的 `subscriptionBase('nas')` 指向
`https://<你的反代域名:端口>/calendar.ics`。

## 安全

- service_role key 只存在容器环境变量（宿主机 `.env`，`chmod 600`，不进 git）；
- 容器端口只绑宿主机回环，LAN 不可达；
- 对外仅一条路径，且必须带 64 位 hex key；key 无效只返回纯文本 404，不泄漏库结构；
- 容器以 `nobody` 运行、只读根、`cap_drop: ALL`。

## 回退

```bash
docker compose down      # 停容器
rm -rf /vol1/1000/docker/calendar-svc
# 再删掉 Lucky 那条 /calendar.ics 规则
```
