# -*- coding: utf-8 -*-
"""
把 NocoDB 的 SQLite（noco.db）迁到律师工作台的 Postgres / 演示数据。

安全设计（字段级端到端加密）：
  - 手机号、伤情、详细情况等敏感原文 → AES-256-GCM 加密后上云，云上只有密文
  - 同时生成一份「手机号已脱敏」的明文副本，供列表展示与搜索
  - 密钥由主口令经 PBKDF2-SHA256(210000) 派生，算法参数与浏览器 Web Crypto 完全一致

用法：
    python migrate_noco.py                      # 用演示口令生成 demo.json
    set VAULT_PASSPHRASE=你的主口令             # 用真实主口令重新加密
    python migrate_noco.py --db 路径 --out 目录
"""
import argparse
import base64
import hashlib
import json
import os
import re
import secrets
import sqlite3
import sys
from datetime import date, datetime

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

SALT = b"lawyer-workbench-v1"   # 固定 salt：不敏感，用于确定性派生
ITERATIONS = 210000             # 与 src/lib/crypto.ts 保持一致
KEY_LEN = 32
IV_LEN = 12
VERIFIER_PLAIN = "lawyer-workbench-ok"   # 口令校验串的明文（固定值，非机密）

PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
IDCARD_RE = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")


# ---------------- 加密 ----------------

def derive_key(passphrase: str) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=KEY_LEN, salt=SALT, iterations=ITERATIONS)
    return kdf.derive(passphrase.encode("utf-8"))


def make_encryptor(passphrase: str):
    key = derive_key(passphrase)
    aes = AESGCM(key)

    def enc(plain):
        if plain is None or str(plain).strip() == "":
            return None
        iv = secrets.token_bytes(IV_LEN)
        ct = aes.encrypt(iv, str(plain).encode("utf-8"), None)
        return "v1:%s:%s" % (
            base64.b64encode(iv).decode(),
            base64.b64encode(ct).decode(),
        )

    return enc, base64.b64encode(key).decode()


# ---------------- 脱敏 ----------------

def mask_phone(m: re.Match) -> str:
    s = m.group(0)
    return s[:3] + "****" + s[7:]


def mask_idcard(m: re.Match) -> str:
    s = m.group(0)
    return s[:6] + "********" + s[-4:]


def mask_text(t):
    """保留可读文本，但把手机号/身份证打码——这份可以明文上云。"""
    if not t:
        return None
    s = PHONE_RE.sub(mask_phone, str(t))
    s = IDCARD_RE.sub(mask_idcard, s)
    return s


def has_sensitive(t) -> bool:
    if not t:
        return False
    s = str(t)
    return bool(PHONE_RE.search(s) or IDCARD_RE.search(s))


def extract_phones(t):
    return PHONE_RE.findall(str(t)) if t else []


# ---------------- 读取 ----------------

T_INTAKE = "nc_5q_g___主-接案汇总表"
T_CASE = "nc_5q_g__主-办案进度表"
T_TIMELINE = "nc_5q_g___次2案件时间线"
T_EXPENSE = "nc_5q_g__次1费用详情表"
T_M2M = "nc_5q_g___nc_m2m_nc_5q_g__主-办案进度_nc_5q_g__次3诉讼仲裁"


def rows(con, table):
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute('SELECT * FROM "%s" WHERE COALESCE(__nc_deleted,0)=0 ORDER BY id' % table)
    return [dict(r) for r in cur.fetchall()]


def norm_date(v):
    if not v:
        return None
    s = str(v).strip()
    if not s:
        return None
    return s[:10]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=r"D:\Downloads\noco.db")
    ap.add_argument("--out", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap.add_argument("--passphrase", default=os.environ.get("VAULT_PASSPHRASE", "demo-2026"))
    args = ap.parse_args()

    enc, _ = make_encryptor(args.passphrase)

    con = sqlite3.connect(args.db)
    intakes = rows(con, T_INTAKE)
    cases = rows(con, T_CASE)
    timelines = rows(con, T_TIMELINE)
    expenses = rows(con, T_EXPENSE)

    # m2m: 时间线 -> 办案进度
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    tl2case = {}
    try:
        cur.execute('SELECT * FROM "%s"' % T_M2M)
        for r in cur.fetchall():
            d = dict(r)
            tl2case[d.get("nc_5q_g__次3诉讼仲裁案件时间线_id")] = d.get("nc_5q_g__主-办案进度表_id")
    except Exception as e:
        print("  [warn] m2m 读取失败，回退到姓名匹配:", e, file=sys.stderr)

    # 委托人 -> case_id（回退用）
    name2case = {}
    for c in cases:
        nm = (c.get("委托人") or "").strip()
        if nm and nm not in name2case:
            name2case[nm] = c["id"]

    # ---------- cases ----------
    out_cases = []
    for c in cases:
        detail = c.get("详细情况") or ""
        out_cases.append({
            "id": int(c["id"]),
            "client": (c.get("委托人") or "").strip(),
            "cause": (c.get("案由") or "").strip() or "未分类",
            "stage": (c.get("案件阶段") or "").strip() or "在办",
            "next_action": (c.get("下一步工作") or "").strip(),
            "next_due": norm_date(c.get("下一步工作的日期")),
            "first_contact": norm_date(c.get("首触时间")),
            "signed_at": norm_date(c.get("签单日")),
            "detail_mask": mask_text(detail),
            "detail_enc": enc(detail) if detail.strip() else None,
            "has_secret": has_sensitive(detail),
        })

    # ---------- intakes（接案线索，含未签单） ----------
    signed_names = {(c.get("委托人") or "").strip() for c in cases}
    out_intakes = []
    for i in intakes:
        note = i.get("跟踪情况") or ""
        nm = (i.get("委托人") or "").strip()
        out_intakes.append({
            "id": int(i["id"]),
            "client": nm,
            "first_contact": norm_date(i.get("首触时间")),
            "signed_at": norm_date(i.get("签单日")),
            "converted": nm in signed_names,
            "note_mask": mask_text(note),
            "note_enc": enc(note) if note.strip() else None,
            "phones": [{"enc": enc(p), "mask": PHONE_RE.sub(mask_phone, p)} for p in extract_phones(note)],
        })

    # ---------- timeline ----------
    out_tl = []
    for t in timelines:
        content = t.get("内容") or ""
        cid = tl2case.get(t["id"]) or name2case.get((t.get("委托人") or "").strip())
        out_tl.append({
            "id": int(t["id"]),
            "case_id": int(cid) if cid else None,
            "at": norm_date(t.get("时间")),
            "content_mask": mask_text(content),
            "content_enc": enc(content) if content.strip() else None,
        })

    # ---------- expenses ----------
    out_exp = []
    for e in expenses:
        out_exp.append({
            "id": int(e["id"]),
            "case_id": int(e["nc_5q_g__办案进度表_id"]) if e.get("nc_5q_g__办案进度表_id") else None,
            "direction": (e.get("收支") or "").strip(),
            "category": (e.get("分类") or "").strip(),
            "at": norm_date(e.get("时间")),
            "amount": e.get("开票金额"),
            "personal": e.get("个人得金额"),
            "detail": mask_text(e.get("费用详情")),
            "detail_enc": enc(e.get("费用详情")) if (e.get("费用详情") or "").strip() else None,
        })

    # ---------- 输出 ----------
    root = args.out
    os.makedirs(os.path.join(root, "src", "data"), exist_ok=True)
    os.makedirs(os.path.join(root, "supabase"), exist_ok=True)

    # 口令校验串：用主口令加密一段固定明文。解锁时试着解开它，
    # 解不开就说明口令错了——避免「输错口令也提示成功、随后解密全是乱码」。
    verifier = enc(VERIFIER_PLAIN)

    payload = {
        "version": 1,
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "crypto": {
            "alg": "AES-256-GCM", "kdf": "PBKDF2-SHA256",
            "iterations": ITERATIONS, "salt": SALT.decode(), "verifier": verifier,
        },
        "cases": out_cases,
        "intakes": out_intakes,
        "timeline": out_tl,
        "expenses": out_exp,
    }
    demo_path = os.path.join(root, "src", "data", "demo.json")
    with open(demo_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    # 统计
    n_phone = sum(1 for i in out_intakes if i["phones"])
    n_secret = sum(1 for i in out_intakes if i["note_enc"] and has_sensitive(i["note_mask"]) is False)
    print("已生成 %s" % demo_path)
    print("  案件 cases    : %d" % len(out_cases))
    print("  线索 intakes  : %d（其中 %d 条含手机号，已加密）" % (len(out_intakes), n_phone))
    print("  时间线 timeline: %d" % len(out_tl))
    print("  费用 expenses : %d" % len(out_exp))
    print("  敏感加密字段  : %d 条" % n_secret)
    print("  口令: %s（生产环境请用 VAULT_PASSPHRASE 设置）" % args.passphrase)


if __name__ == "__main__":
    main()
