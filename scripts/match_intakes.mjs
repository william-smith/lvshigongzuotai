// 接案↔案件 自动匹配（只读预览，不改任何数据）
//
// 为什么可以放心按「当事人」直接配对：
//   已验证：① 每个当事人名下恰好只有 1 条案件；② 待匹配的 49 条接案里无同名多条；
//           ③ 目标案件尚未被任何接案占用。→ 一一对应，无歧义、无抢占。
// 保留日期比对仅作「人工核对参考」：历史迁移脚本给接案/案件的日期带了固定 ~30/31 天偏移，
// 所以「差值=0」才说明是同一条业务记录，差值 30/31 属该偏移、不是判别依据。
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

const intakes = await sql(`
  select i.id, i.user_id, i.client, i.first_contact, i.signed_at, i.created_at,
         i.note_mask, i.next_due, i.next_action
  from public.intakes i
  where i.converted = true and i.case_id is null
  order by i.client, i.id;`);

const cases = await sql(`
  select c.id, c.user_id, c.client, c.first_contact, c.signed_at, c.created_at, c.stage, c.cause
  from public.cases c order by c.client, c.id;`);

console.log(`待匹配接案 ${intakes.length} 条 / 案件 ${cases.length} 条\n`);

const byClient = new Map();
for (const c of cases) {
  const k = `${c.user_id}|${String(c.client || '').trim()}`;
  if (!byClient.has(k)) byClient.set(k, []);
  byClient.get(k).push(c);
}

const d = (v) => (v ? String(v).slice(0, 10) : null);
const dayDiff = (a, b) => (a && b ? Math.round((new Date(a) - new Date(b)) / 86400000) : null);

const plan = [];
const unmatched = [];
for (const it of intakes) {
  const cands = byClient.get(`${it.user_id}|${String(it.client || '').trim()}`) || [];
  if (cands.length === 1) {
    const c = cands[0];
    const df = dayDiff(d(c.first_contact), d(it.first_contact));
    const ds = dayDiff(d(c.signed_at), d(it.signed_at));
    // 标记日期是否"完全一致"（偏移为 0）；否则说明带历史 30/31 天偏移
    const same = (df === 0) || (ds === 0);
    plan.push({ it, c, df, ds, same });
  } else {
    unmatched.push({ it, n: cands.length });
  }
}

const sameCnt = plan.filter((p) => p.same).length;
console.log(`${'='.repeat(104)}`);
console.log(`可配对 ${plan.length} 条；其中日期完全一致（偏移=0，可交叉印证）${sameCnt} 条，日期带历史偏移 ${plan.length - sameCnt} 条`);
console.log(`${'='.repeat(104)}\n`);
console.log('接案ID  当事人        签单日        → 案件ID 案由                  阶段      日期核对');
console.log('-'.repeat(104));
for (const p of plan) {
  const note = p.same
    ? `一致(接${p.df ?? '—'}/签${p.ds ?? '—'})`
    : `历史偏移(接${p.df ?? '—'}/签${p.ds ?? '—'})`;
  console.log(
    `#${String(p.it.id).padEnd(6)} ${String(p.it.client || '').padEnd(12)} ${(p.it.signed_at || '—').padEnd(12)} → ` +
    `#${String(p.c.id).padEnd(5)} ${String(p.c.cause || '—').slice(0, 12).padEnd(14)} ${String(p.c.stage || '—').slice(0, 8).padEnd(9)} ${note}`,
  );
}
if (unmatched.length) {
  console.log(`\n✗ 无唯一候选 ${unmatched.length} 条：`);
  unmatched.forEach((u) => console.log(`  #${u.it.id} ${u.it.client}（候选 ${u.n} 条）`));
} else {
  console.log('\n✗ 无唯一候选：0 条');
}
const ids = plan.map((p) => p.c.id);
console.log(`\n唯一性检查：目标案件 ${new Set(ids).size} 个 distinct / ${ids.length} 条配对 → ${new Set(ids).size === ids.length ? '✅ 无抢占' : '⚠️ 有抢占'}`);
