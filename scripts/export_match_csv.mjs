// 导出匹配对照表 CSV（新名→原名式对照，供人工核对与一键回滚）
// 生成 _out/intake_case_map.csv：intake_id,intake_client,case_id,case_client,match_basis
// 不写数据库，纯导出。
import fs from 'node:fs';

const PAT = (process.env.SBP || '').trim();
const MGMT = 'https://api.supabase.com/v1/projects/eossyfugqwnpqdixmvyy/database/query';
async function sql(q) {
  const r = await fetch(MGMT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
}

const intakes = await sql(`select id,user_id,client,first_contact,signed_at from public.intakes where converted=true and case_id is null order by client,id;`);
const cases = await sql(`select id,user_id,client,cause,stage,first_contact,signed_at from public.cases order by client,id;`);

const byClient = new Map();
for (const c of cases) {
  const k = `${c.user_id}|${String(c.client || '').trim()}`;
  if (!byClient.has(k)) byClient.set(k, []);
  byClient.get(k).push(c);
}
const d = (v) => (v ? String(v).slice(0, 10) : '');
const diff = (a, b) => (a && b ? Math.round((new Date(a) - new Date(b)) / 86400000) : '');

const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const rows = [['intake_id', 'intake_client', 'intake_signed_at', 'case_id', 'case_client', 'case_cause', 'case_stage', 'date_check', 'verdict']];

let n = 0, no = 0;
for (const it of intakes) {
  const cands = byClient.get(`${it.user_id}|${String(it.client || '').trim()}`) || [];
  if (cands.length !== 1) { no++; continue; }
  const c = cands[0];
  const df = diff(d(c.first_contact), d(it.first_contact));
  const ds = diff(d(c.signed_at), d(it.signed_at));
  const same = df === 0 || ds === 0;
  rows.push([
    it.id, it.client, d(it.signed_at),
    c.id, c.client, c.cause, c.stage,
    `first:${df} signed:${ds}`,
    same ? 'dates_match' : 'offset30_hist',
  ]);
  n++;
}

const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
fs.writeFileSync('_out/intake_case_map.csv', csv, 'utf8');
console.log(`已导出 _out/intake_case_map.csv：${n} 条配对，${no} 条无唯一候选`);
console.log(`其中 dates_match（日期可交叉印证）${rows.filter((r) => r[8] === 'dates_match').length - 0} 条`);
