// 仅供 CI/一次性核查用：只读探测云端库是否已有 intakes 的日历列。
// 用法：node scripts/probe_intake_cols.mjs
// 背景：新增 next_due / remind_rules 两列后，若云端库未迁移就发版，
//      前端保存接案会因 PostgREST 42703（column does not exist）直接失败。
//      部署前先跑这个探针确认列已就位。
import fs from 'node:fs';

const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const key = (env.match(/VITE_API_KEY=(.+)/) || [, ''])[1].trim();
const base = (env.match(/VITE_API_BASE=(.+)/) || [, ''])[1].trim();
const P = `${base.replace(/\/$/, '')}`;

const probes = [
  ['cases.next_due       (基线，应 200)', 'cases?select=id,next_due&limit=1'],
  ['intakes.next_due     (新列，须 200)', 'intakes?select=id,next_due&limit=1'],
  ['intakes.remind_rules (新列，须 200)', 'intakes?select=id,remind_rules&limit=1'],
  ['intakes.next_action  (新列，须 200)', 'intakes?select=id,next_action&limit=1'],
  ['intakes.case_id      (新列，须 200)', 'intakes?select=id,case_id&limit=1'],
  ['intakes 整表          (基线，应 200)', 'intakes?select=id&limit=1'],
];

let failed = false;
for (const [label, path] of probes) {
  try {
    const r = await fetch(`${P}/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const body = (await r.text()).slice(0, 200);
    const bad = r.status !== 200;
    if (bad) failed = true;
    console.log(`${bad ? '✗' : '✓'} HTTP ${r.status}  ${label}\n    ${body}\n`);
  } catch (e) {
    failed = true;
    console.log(`✗ ERR  ${label}\n    ${e.message}\n`);
  }
}
console.log(failed ? '结论：云端库未完成迁移，现在发版会破坏接案保存。' : '结论：云端库已就位，可发版。');
process.exit(failed ? 1 : 0);
