// 云端日历订阅 Function（Cloudflare Pages Functions）
// 生成 text/calendar；按 ?key 反查 ical_tokens 得 user_id，用 service_role 读该用户
// 「在办且有期限」案件 + 「设有节点时间」的接案线索，二者合并进同一份日历。
// 部署：随 wrangler pages deploy 一并上传。需 CF 变量/密钥：
//   SUPABASE_URL（默认云端项目地址）、SUPABASE_ANON_KEY（公开 anon）、SUPABASE_SERVICE_ROLE_KEY（wrangler secret put）
// 时区约定：next_due 为北京时间 naive timestamp，输出时转 UTC（Z），与日历本机时区无关。

interface CalEvent {
  uid: string;
  client: string | null;
  cause: string | null;
  /** 具体事项：案件/接案都是 next_action（接案未填则回落「接案跟踪」） */
  matter: string | null;
  /** 案由段：案件=cause；接案固定「接案」，使标题统一为「委托人 · 接案 · 事项」 */
  cause?: string | null;
  next_due: string | null;
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

function buildIcs(events: CalEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//lawyer-workbench//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const nowUtc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  for (const e of events) {
    const dt = dtstartUtc(e.next_due || '');
    if (!dt) continue;
    const uid = e.uid;
    // 日历上只写两样：名称（委托人·案由 / 委托人·接案跟踪）+ 具体事项（下一节点）。
    // 事件时间 = 节点时间（精确到分钟）；提醒 = 节点时间 − 到期提醒（下方 VALARM）。
    const cn = (e.client || '').trim(); // 委托人
    const cs = (e.cause || '').trim(); // 案由（接案无）
    const caseName = cn ? (cs ? `${cn} · ${cs}` : cn) : cs || (e.matter || '事件');
    const matter = (e.matter || '').trim(); // 具体事项
    const summary = escapeIcs(matter ? `${caseName} · ${matter}` : caseName);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${nowUtc}`);
    lines.push(`DTSTART:${dt}`);
    lines.push(`SUMMARY:${summary}`);
    // 不再单列 DESCRIPTION：具体事项已并入标题，日历上不出现其它冗余内容
    const rules = (e.remind_rules || []).filter((r) => Boolean(r && r.trim()));
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
    const cases = (await casesRes.json()) as Array<{
      id: number;
      cause: string | null;
      client: string | null;
      next_due: string | null;
      next_action: string | null;
      remind_rules: string[] | null;
    }>;

    // 3) 用 service_role 读该用户「设有节点时间」的接案线索（绕 RLS，已按 user_id 收敛范围）
    const intsRes = await fetch(
      `${supabase}/rest/v1/intakes?user_id=eq.${uid}&next_due=not.is.null` +
        `&select=id,client,next_due,next_action,remind_rules&order=next_due`,
      { headers: { apikey: svc, authorization: `Bearer ${svc}` } }
    );
    const intakes = (await intsRes.json()) as Array<{
      id: number;
      client: string | null;
      next_due: string | null;
      next_action: string | null;
      remind_rules: string[] | null;
    }>;

    // 4) 合并：同一份日历里既有案件也有接案
    const events: CalEvent[] = [
      ...(cases || []).map((c) => ({
        uid: `case-${c.id}@lawyer-workbench`,
        client: c.client,
        cause: c.cause,
        matter: c.next_action,
        next_due: c.next_due,
        remind_rules: c.remind_rules,
      })),
      ...(intakes || []).map((i) => ({
        uid: `intake-${i.id}@lawyer-workbench`,
        client: i.client,
        // 接案的「案由」段固定为「接案」，与案件的案由列对齐：
        // 日历标题统一呈「委托人 · 接案 · 节点事项」
        cause: '接案',
        // 事项 = 用户填的「节点事项」；没填才回落成「接案跟踪」
        matter: (i.next_action || '').trim() || '接案跟踪',
        next_due: i.next_due,
        remind_rules: i.remind_rules,
      })),
    ];

    return new Response(buildIcs(events), { headers });
  } catch {
    return new Response(emptyCal(), { headers });
  }
};
