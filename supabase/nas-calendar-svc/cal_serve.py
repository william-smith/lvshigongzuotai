#!/usr/bin/env python3
"""
NAS 端日历订阅桥接服务（纯标准库，无任何第三方依赖）。

为什么需要它：
    PostgREST 的标量 RPC 只能返回 application/json 包裹的字符串，
    且对 Accept: text/calendar / text/plain 一律返回 406 (PGRST107)。
    而日历客户端（Outlook / iOS / Google）只会发 GET + Accept: text/calendar，
    也不会带 apikey 头。所以必须有一层做三件事：
        1) 代打 service_role 鉴权；
        2) 拆掉 JSON 包裹（json.loads）还原原始 iCal 文本；
        3) 以 Content-Type: text/calendar 输出。

对外只暴露一个接口：
    GET /calendar.ics?key=<64 位小写十六进制>
另有 /healthz 供容器健康检查。

安全：
    - service_role key 只存在于容器环境变量（来自宿主机 .env，chmod 600）；
    - key 先做格式校验，真正的有效性校验交给 SQL 侧 calendar_ics() 的 digest 比对；
    - 校验不通过只返回 404 + 纯文本，不泄漏库结构。
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

LISTEN_HOST = os.environ.get("LISTEN_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8899"))

UPSTREAM = os.environ.get(
    "UPSTREAM",
    "http://supabase-selfhosted-kong-1:8000/rest/v1/rpc/calendar_ics",
)
# musl 解析不了 compose 服务名时的兜底（Kong 在 supabase 网络内的 IP）
UPSTREAM_FALLBACK = os.environ.get("UPSTREAM_FALLBACK", "")

SERVICE_KEY = os.environ.get("CAL_SERVICE_ROLE_KEY", "").strip()
TIMEOUT = float(os.environ.get("UPSTREAM_TIMEOUT", "8"))

KEY_RE = re.compile(r"^[0-9a-f]{64}$")

ICAL_HEADERS = [
    ("Content-Type", "text/calendar; charset=utf-8; component=vevent"),
    ("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"),
    ("Pragma", "no-cache"),
    ("Content-Disposition", 'inline; filename="calendar.ics"'),
]


def log(msg: str) -> None:
    sys.stderr.write("[cal-ics] %s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    sys.stderr.flush()


def unwrap(raw: str) -> str:
    """拆 PostgREST 的 JSON 包裹；已是明文则原样返回。"""
    raw = (raw or "").strip()
    if not raw:
        return ""
    if raw.startswith('"'):
        try:
            return json.loads(raw) or ""
        except Exception:
            return ""
    return raw


def fetch_ics(key: str) -> str:
    urls = [UPSTREAM] + ([UPSTREAM_FALLBACK] if UPSTREAM_FALLBACK else [])
    body = json.dumps({"p_key": key}).encode("utf-8")
    last_err = None
    for url in urls:
        if not url:
            continue
        req = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "apikey": SERVICE_KEY,
                "Authorization": "Bearer " + SERVICE_KEY,
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return unwrap(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - 任何上游异常都转成 502
            last_err = exc
            log("upstream %s failed: %r" % (url, exc))
    if last_err:
        raise last_err
    return ""


class Handler(BaseHTTPRequestHandler):
    server_version = "cal-ics/1.0"
    protocol_version = "HTTP/1.1"

    # BaseHTTPRequestHandler 默认把每次请求打到 stderr，这里收敛成一行
    def log_message(self, fmt, *args):  # noqa: D401
        log("%s - %s" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, extra_headers=None) -> None:
        self.send_response(status)
        for k, v in (extra_headers or [("Content-Type", "text/plain; charset=utf-8")]):
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _text(self, status: int, msg: str) -> None:
        self._send(status, msg.encode("utf-8"), [("Content-Type", "text/plain; charset=utf-8"),
                                                 ("Cache-Control", "no-store")])

    def _serve(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/healthz":
            self._text(200, "ok")
            return

        if path != "/calendar.ics":
            self._text(404, "not found")
            return

        key = (parse_qs(parsed.query).get("key") or [""])[0].strip().lower()
        if not KEY_RE.match(key):
            self._text(404, "invalid key")
            return

        try:
            ics = fetch_ics(key)
        except Exception as exc:  # noqa: BLE001
            log("ERROR serving key %s…: %r" % (key[:8], exc))
            self._text(502, "upstream error")
            return

        if not ics or "BEGIN:VCALENDAR" not in ics:
            self._text(404, "no calendar for this key")
            return

        data = ics.encode("utf-8")
        headers = list(ICAL_HEADERS)
        if self.command == "HEAD":
            data = b""
        self._send(200, data, headers)

    do_GET = _serve
    do_HEAD = _serve


def main() -> None:
    if not SERVICE_KEY:
        log("FATAL: CAL_SERVICE_ROLE_KEY is empty")
        sys.exit(1)
    log("listening on %s:%s -> %s" % (LISTEN_HOST, LISTEN_PORT, UPSTREAM))
    ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
