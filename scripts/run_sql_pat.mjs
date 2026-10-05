// 用 PAT 验证连通性 + 执行 DDL。凭据从环境变量读，不落盘。
// 用法：SBP=<pat> node scripts/run_sql_pat.mjs supabase/add_intake_remind_cloud.sql
import fs from 'node:fs';

const pat = (process.env.SBP || '').trim();
if (!pat) {
  console.error('缺少环境变量 SBP');
  process.exit(2);
}

const sqlPath = process.argv[2];
if (!sqlPath) {
  console.error('用法：SBP=<pat> node scripts/run_sql_pat.mjs <sql 文件>');
  process.exit(2);
}
const sql = fs.readFileSync(sqlPath, 'utf8');

// 从 .env.local 或 .env 拿 ref
let ref = '';
for (const f of ['../.env.local', '../.env']) {
  try {
    const t = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    const m = t.match(/VITE_API_BASE=.*?([a-z]{20})\.supabase\.co/);
    if (m) { ref = m[1]; break; }
  } catch { /* 换下一个 */ }
}
if (!ref) {
  // 兜底：直接用线上反代函数里已确认的 ref
  ref = 'eossyfugqwnpqdixmvyy';
}
console.log(`项目 ref = ${ref}`);
console.log(`SQL 文件 = ${sqlPath} (${sql.length} 字节)\n`);

const url = `https://api.supabase.com/v1/projects/${ref}/database/query`;
const r = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${pat}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

const body = await r.text();
console.log(`HTTP ${r.status}`);
console.log(body.slice(0, 3000));
process.exit(r.ok ? 0 : 1);
