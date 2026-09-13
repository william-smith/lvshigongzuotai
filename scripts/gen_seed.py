# -*- coding: utf-8 -*-
"""把 src/data/demo.json 转成 supabase/seed.sql，方便导入真实数据库。

    python scripts/gen_seed.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def inserts(table, cols, rows):
    if not rows:
        return "-- (无数据)\n"
    out = []
    for r in rows:
        vals = ", ".join(q(r.get(c)) for c in cols)
        out.append(f"insert into public.{table} ({', '.join(cols)}) values ({vals}) on conflict (id) do nothing;")
    return "\n".join(out) + "\n"


def main():
    d = json.load(open(os.path.join(ROOT, "src", "data", "demo.json"), encoding="utf-8"))

    sql = ["-- 由 scripts/gen_seed.py 自动生成，请勿手工编辑", "begin;", ""]

    sql.append("-- 案件")
    sql.append(
        inserts(
            "cases",
            ["id", "client", "cause", "stage", "stage_norm", "next_action", "next_due", "first_contact",
             "signed_at", "detail_mask", "detail_enc", "has_secret"],
            [
                {
                    "id": c["id"], "client": c["client"], "cause": c["cause"], "stage": c["stage"],
                    "stage_norm": ('解除委托' if '解除委托' in (c['stage'] or '') else '结案' if '结案' in (c['stage'] or '') else '在办'),
                    "next_action": c.get("next_action"), "next_due": c.get("next_due"),
                    "first_contact": c.get("first_contact"), "signed_at": c.get("signed_at"),
                    "detail_mask": c.get("detail_mask"), "detail_enc": c.get("detail_enc"),
                    "has_secret": c.get("has_secret", False),
                }
                for c in d["cases"]
            ],
        )
    )

    sql.append("-- 接案线索")
    sql.append(
        inserts(
            "intakes",
            ["id", "client", "first_contact", "signed_at", "converted", "note_mask", "note_enc"],
            [
                {
                    "id": i["id"], "client": i["client"], "first_contact": i.get("first_contact"),
                    "signed_at": i.get("signed_at"), "converted": i.get("converted", False),
                    "note_mask": i.get("note_mask"), "note_enc": i.get("note_enc"),
                }
                for i in d["intakes"]
            ],
        )
    )

    contacts = []
    for i in d["intakes"]:
        for p in i.get("phones", []):
            contacts.append({"intake_id": i["id"], "phone_mask": p["mask"], "phone_enc": p["enc"]})
    sql.append("-- 加密联系方式")
    if contacts:
        sql.append(
            "\n".join(
                f"insert into public.contacts (intake_id, phone_mask, phone_enc) values "
                f"({q(c['intake_id'])}, {q(c['phone_mask'])}, {q(c['phone_enc'])});"
                for c in contacts
            )
            + "\n"
        )
    else:
        sql.append("-- (无数据)\n")

    sql.append("-- 时间线")
    sql.append(
        inserts(
            "timeline",
            ["id", "case_id", "at", "content_mask", "content_enc"],
            [
                {"id": t["id"], "case_id": t.get("case_id"), "at": t.get("at"),
                 "content_mask": t.get("content_mask"), "content_enc": t.get("content_enc")}
                for t in d["timeline"]
            ],
        )
    )

    sql.append("-- 费用")
    sql.append(
        inserts(
            "expenses",
            ["id", "case_id", "direction", "category", "at", "amount", "personal", "detail", "detail_enc"],
            [
                {"id": e["id"], "case_id": e.get("case_id"), "direction": e.get("direction"),
                 "category": e.get("category"), "at": e.get("at"), "amount": e.get("amount"),
                 "personal": e.get("personal"), "detail": e.get("detail"), "detail_enc": e.get("detail_enc")}
                for e in d["expenses"]
            ],
        )
    )

    # 口令校验串（与 src/lib/crypto.ts 的 verifyKey 配套）
    verifier = (d.get("crypto") or {}).get("verifier")
    if verifier:
        sql.append("-- 口令校验串（只用于判断口令对错，不含密钥）")
        sql.append(
            "insert into public.vault_meta (id, kdf, iterations, salt, verifier_enc) values "
            "(1, %s, %s, %s, %s) on conflict (id) do update set verifier_enc = excluded.verifier_enc;"
            % (q((d.get("crypto") or {}).get("kdf")),
               q((d.get("crypto") or {}).get("iterations")),
               q((d.get("crypto") or {}).get("salt")),
               q(verifier))
            + "\n"
        )

    sql.append("commit;")

    path = os.path.join(ROOT, "supabase", "seed.sql")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(sql))
    print("已生成", path)
    print("  案件 %d · 线索 %d · 号码 %d · 时间线 %d · 费用 %d" % (
        len(d["cases"]), len(d["intakes"]), len(contacts), len(d["timeline"]), len(d["expenses"])))


if __name__ == "__main__":
    main()
