// 回填前备份：把 49 条接案当前的 case_id/converted 原值导出，供一键回滚
import fs from 'node:fs';
const PAT = (process.env.SBP || '').trim();
const MGMT = 'https://api.supabase.com/v1/projects/eossyfugqwnpqdixmvyy/database/query';
async function sql(q) {
  const r = await fetch(MGMT, { method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
}

const rows = await sql(`
  select id, user_id, client, case_id, converted, updated_at
  from public.intakes
  where converted = true and case_id is null
  order by id;`);

const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const out = [['intake_id', 'client', 'case_id_before', 'converted_before', 'updated_at_before', 'rollback_case_id', 'rollback_converted']];
for (const r of rows) {
  // 回滚用：把 case_id 还原成 before 值（此批全是 null），converted 还原成 before 值
  out.push([r.id, r.client, r.case_id, r.converted, r.updated_at, r.case_id, r.converted]);
}
fs.writeFileSync('_out/rollback_intakes.csv', '﻿' + out.map((r) => r.map(esc).join(',')).join('\r\n'), 'utf8');
console.log(`已备份 ${rows.length} 条原值 → _out/rollback_intakes.csv`);
console.log(`其中 case_id 全为 null：${rows.every((r) => r.case_id === null) ? '是 ✅' : '否 ⚠️ 需人工检查'}`);
