#!/usr/bin/env python3
"""
把 NAS 案件到期日历同步进 Radicale（CalDAV）。

思路：
    1) 用已有的 calendar_ics() RPC（内部专用订阅 key）取回完整 VCALENDAR；
    2) 按 VEVENT 切成单事件对象（保留原 UID）；
    3) 通过 CalDAV 的 PUT 写进 Radicale 的 /<user>/<collection>/，删除已消失的 UID。

安全性设计：
    - 只有 RPC 成功且事件数 > 0 时才执行删除，避免上游故障把日历清空；
    - 全程 Basic Auth 走本机回环（127.0.0.1:5232），不经过公网。

用法（宿主机 python3.12 + cron）：
    */5 * * * * /usr/local/bin/python3.12 /vol1/1000/docker/caldav/sync_caldav.py \
        >> /vol1/1000/docker/caldav/sync.log 2>&1
"""
import json
import os
import re
import sys
import time
import base64
import urllib.error
import urllib.request
from urllib.parse import unquote
from xml.etree import ElementTree

DIR = os.path.dirname(os.path.abspath(__file__))

BASE = os.environ.get("CALDAV_BASE", "http://127.0.0.1:5232").rstrip("/")
USER = os.environ.get("CALDAV_USER", "lawyer")
PASS = os.environ.get("CALDAV_PASS", "")
COLLECTION = os.environ.get("CALDAV_COLLECTION", "cases")

RPC_URL = os.environ.get(
    "RPC_URL", "http://127.0.0.1:8000/rest/v1/rpc/calendar_ics"
)
SERVICE_KEY = os.environ.get("CAL_SERVICE_ROLE_KEY", "").strip()
ICS_KEY = os.environ.get("CALDAV_ICS_KEY", "").strip()

TIMEOUT = float(os.environ.get("SYNC_TIMEOUT", "15"))
MIN_EVENTS = int(os.environ.get("SYNC_MIN_EVENTS", "1"))  # 低于该数量视为异常，不删任何东西

AUTH = base64.b64encode(f"{USER}:{PASS}".encode()).decode()
DAV = "{DAV:}"


def log(msg):
    sys.stderr.write("[sync-cal] %s %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg))
    sys.stderr.flush()


def http(method, url, body=None, headers=None):
    data = body.encode("utf-8") if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    req.add_header("Authorization", "Basic " + AUTH)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace") if e.fp else ""


def fetch_ics():
    body = json.dumps({"p_key": ICS_KEY}).encode("utf-8")
    req = urllib.request.Request(
        RPC_URL, data=body, method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "apikey": SERVICE_KEY,
            "Authorization": "Bearer " + SERVICE_KEY,
        },
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read().decode("utf-8").strip()
    if raw.startswith('"'):
        raw = json.loads(raw) or ""
    return raw


def split_events(raw):
    """把 VCALENDAR 拆成 {(uid): 单事件 VCALENDAR 文本}"""
    lines = [l.rstrip("\r") for l in raw.split("\n") if l.strip() != ""]
    prelude, events, cur, uid = [], {}, None, None
    for line in lines:
        if line == "BEGIN:VEVENT":
            cur = [line]
            uid = None
            continue
        if cur is not None:
            cur.append(line)
            if line.startswith("UID:"):
                uid = line[4:].strip()
            if line == "END:VEVENT" and uid:
                wrap = ["BEGIN:VCALENDAR"] + [
                    p for p in prelude if not p.startswith("BEGIN:VCALENDAR")
                ]
                events[uid] = "\r\n".join(wrap + cur + ["END:VCALENDAR"]) + "\r\n"
                cur = None
            continue
        if line.startswith("BEGIN:VCALENDAR") or line.startswith("END:VCALENDAR"):
            continue
        prelude.append(line)
    return events


def ensure_collection():
    url = f"{BASE}/{USER}/{COLLECTION}/"
    code, _ = http("PROPFIND", url, headers={"Depth": "0"})
    if code == 404 or code == 405:
        mk = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
            "<D:set><D:prop>"
            "<D:displayname>案件到期</D:displayname>"
            "<C:calendar-description>律师工作台案件节点</C:calendar-description>"
            '<C:supported-calendar-component-set>'
            '<C:comp name="VEVENT"/></C:supported-calendar-component-set>'
            "</D:prop></D:set></C:mkcalendar>"
        )
        code, body = http("MKCALENDAR", url, mk,
                          headers={"Content-Type": "application/xml; charset=utf-8"})
        log(f"MKCALENDAR -> {code} {body[:120]}")
    return code


def existing_uids():
    propfind = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>'
    )
    code, body = http(
        "PROPFIND", f"{BASE}/{USER}/{COLLECTION}/", propfind,
        headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
    )
    if code not in (200, 207):
        log(f"PROPFIND failed: {code}")
        return set()
    uids = set()
    try:
        root = ElementTree.fromstring(body)
        for href in root.iter(DAV + "href"):
            # href 里的 UID 可能被百分号转义（如 case-81@… → case-81%40…），必须解码后比对
            path = unquote((href.text or "").strip()).rstrip("/")
            name = path.split("/")[-1]
            if name.endswith(".ics") and name != COLLECTION + ".ics":
                uids.add(name[:-4])
    except Exception as e:
        log(f"parse PROPFIND failed: {e!r}")
    return uids


def main():
    if not (SERVICE_KEY and ICS_KEY and PASS):
        log("FATAL: missing SERVICE_KEY / ICS_KEY / PASS")
        return 1

    raw = fetch_ics()
    events = split_events(raw)
    log(f"fetched {len(events)} events from RPC")

    if len(events) < MIN_EVENTS:
        log(f"ABORT: only {len(events)} events (< {MIN_EVENTS}), skip write/delete")
        return 2

    ensure_collection()

    ok = fail = 0
    for uid, text in events.items():
        code, body = http(
            "PUT", f"{BASE}/{USER}/{COLLECTION}/{uid}.ics", text,
            {"Content-Type": "text/calendar; charset=utf-8"},
        )
        if code in (200, 201, 204):
            ok += 1
        else:
            fail += 1
            log(f"PUT {uid[:24]} failed: {code} {body[:100]}")
    log(f"PUT ok={ok} fail={fail}")

    stale = existing_uids() - set(events)
    deleted = 0
    for uid in stale:
        code, _ = http("DELETE", f"{BASE}/{USER}/{COLLECTION}/{uid}.ics")
        if code in (200, 204):
            deleted += 1
        else:
            log(f"DELETE {uid[:24]} failed: {code}")
    log(f"stale={len(stale)} deleted={deleted}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
