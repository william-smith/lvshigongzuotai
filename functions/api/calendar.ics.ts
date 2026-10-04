// 云端日历订阅 Function（Cloudflare Pages Functions）
// 生成 text/calendar；按 ?key 反查 ical_tokens 得 user_id，用 service_role 读该用户「在办且有期限」案件。
// 部署：随 wrangler pages deploy 一并上传。需 CF 变量/密钥：
//   SUPABASE_URL（默认云端项目地址）、SUPABASE_ANON_KEY（公开 anon）、SUPABASE_SERVICE_ROLE_KEY（wrangler secret put）
// 时区约定：next_due 为北京时间 naive timestamp，输出时转 UTC（Z），与日历本机时区无关。

interface CaseRow {
  id: number;
  cause: string | null;
  client: string | null;
  next_due: string | null;
  next_action: string | null;
  remind_rules: string[] | null;
}

function escapeIcs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r?\n/g, '\\n');
}

function dtstartUtc(nextDue: string): string {
  // next_due 是**北京时间 naive timestamp**（形如 "2026-09-24T09:00:00"，库里不带时区）。
  // ⚠️ 不能直接 new Date(naive) 靠「本地时区」解析——CF Worker 运行时是 UTC，
  // 会把 09:00 当成 09:00 UTC，多 8 小时，日历里就显示成 17:00（NAS 那版 SQL 用
  // AT TIME ZONE 'Asia/Shanghai' 显式换算，是对的）。这里显式补 +08:00 按北京时间
  // 解释再转 UTC，与 NAS 保持一致。
  let s = (nextDue || '').trim();
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (s && !hasTz) s += '+08:00';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function emptyCal(): string {
  return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//lawyer-workbench//CN\r\nEND:VCALENDAR\r\n';
}

function buildIcs(cases: CaseRow[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//lawyer-workbench//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const nowUtc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  for (const c of cases) {
    const dt = dtstartUtc(c.next_due || '');
    if (!dt) continue;
    const uid = `case-${c.id}@lawyer-workbench`;
    // 日历上只写两样：案件名称（委托人·案由）+ 具体事项（下一节点）。
    // 事件时间 = 节点时间（精确到分钟）；提醒 = 节点时间 − 到期提醒（下方 VALARM）。
    const cn = (c.client || '').trim(); // 委托人
    const cs = (c.cause || '').trim(); // 案由
    const caseName = cn ? (cs ? `${cn} · ${cs}` : cn) : cs || '案件';
    const matter = (c.next_action || '').trim(); // 具体事项
    const summary = escapeIcs(matter ? `${caseName} · ${matter}` : caseName);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowUtc}`);
    lines.push(`DTSTART:${dt}`);
    lines.push(`SUMMARY:${summary}`);
    // 不再单列 DESCRIPTION：具体事项已并入标题，日历上不出现其它冗余内容
    const rules = (c.remind_rules || []).filter((r) => Boolean(r && r.trim()));
    if (rules.length === 0) {
      // 未设「到期提醒」→ 准时（节点时间本身）提醒一次
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:${summary}`);
      lines.push(`TRIGGER;VALUE=DATE-TIME:${dt}`);
      lines.push('END:VALARM');
    } else {
      for (const rule of rules) {
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:${summary}`);
        lines.push(`TRIGGER;VALUE=DURATION:-${rule.trim()}`);
        lines.push('END:VALARM');
      }
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const onRequest: PagesFunction = async (context) => {
  const env = context.env as {
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
  };
  const supabase = env.SUPABASE_URL || 'https://eossyfugqwnpqdixmvyy.supabase.co';
  const anon = env.SUPABASE_ANON_KEY || '';
  const svc = env.SUPABASE_SERVICE_ROLE_KEY || '';

  const headers = { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-store' };
  const key = new URL(context.request.url).searchParams.get('key') || '';
  if (!key || !svc) return new Response(emptyCal(), { headers });

  const hash = await sha256Hex(key);
  try {
    // 1) 校验订阅 key → 得 user_id（用 service_role 读 ical_tokens，绕过 RLS：anon 的 auth.uid() 为 null 会被 ical_self 策略拦截，导致永远查不到 user_id）
    const tokRes = await fetch(
      `${supabase}/rest/v1/ical_tokens?token_hash=eq.${hash}&revoked=eq.false&select=user_id`,
      { headers: { apikey: svc, authorization: `Bearer ${svc}` } }
    );
    const tok = (await tokRes.json()) as Array<{ user_id: string }>;
    const uid = tok?.[0]?.user_id;
    if (!uid) return new Response(emptyCal(), { headers });

    // 2) 用 service_role 读该用户在办案件（绕 RLS，已按 user_id 收敛范围）
    const casesRes = await fetch(
      `${supabase}/rest/v1/cases?user_id=eq.${uid}&stage_norm=eq.在办&next_due=not.is.null` +
        `&select=id,cause,client,next_due,next_action,remind_rules&order=next_due`,
      { headers: { apikey: svc, authorization: `Bearer ${svc}` } }
    );
    const cases = (await casesRes.json()) as CaseRow[];
    return new Response(buildIcs(cases || []), { headers });
  } catch {
    return new Response(emptyCal(), { headers });
  }
};
