-- NAS：日历订阅 RPC（SECURITY DEFINER，库内生成 text/calendar）
-- 执行方式：SSH 进 NAS 后 docker exec -i supabase-selfhosted-db-1 psql -U postgres -d postgres < 本文件
-- 调用：GET https://<你的反代域名:端口>/rest/v1/rpc/calendar_ics?key=<明文订阅key>
--        经 PostgREST 以 anon key 调用；函数内部按 key 的 sha256 反查 ical_tokens，读在办案件生成 iCal。
-- 注意：service_role key 不离开 NAS（函数以 DEFINER 提升权限），外部仅传 anon key + 订阅 key。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.calendar_ics(p_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  v_hash   text := encode(digest(p_key, 'sha256'), 'hex');
  CRLF     constant text := chr(13) || chr(10);
  v_lines  text[];
  v_cal    text;
  v_case   record;
  v_rules  jsonb;
  v_i      int;
  v_rule   text;
  v_dt     text;
  v_uid    text;
  v_sum    text;
  v_name   text;
  v_matter text;
  v_has_rule boolean;
  v_alarm  text;
BEGIN
  -- key 校验
  PERFORM 1 FROM ical_tokens WHERE token_hash = v_hash AND revoked = false;
  IF NOT FOUND THEN
    RETURN 'BEGIN:VCALENDAR' || CRLF || 'VERSION:2.0' || CRLF
        || 'PRODID:-//lawyer-workbench//CN' || CRLF || 'END:VCALENDAR';
  END IF;
  UPDATE ical_tokens SET last_used_at = now() WHERE token_hash = v_hash;

  v_lines := ARRAY[
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//lawyer-workbench//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];

  FOR v_case IN
    SELECT id, cause, client, next_due, next_action, remind_rules
    FROM cases
    WHERE stage_norm = '在办' AND next_due IS NOT NULL
    ORDER BY next_due
  LOOP
    -- next_due 为基础 naive timestamp（北京时间），转 UTC 绝对时刻输出 Z
    v_dt := to_char((v_case.next_due AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS') || 'Z';
    v_uid := 'case-' || v_case.id::text || '@lawyer-workbench';
    -- 日历上只写两样：案件名称（委托人·案由）+ 具体事项（下一节点）
    v_name := trim(COALESCE(v_case.client, ''));
    IF v_name <> '' AND COALESCE(v_case.cause, '') <> '' THEN
      v_name := v_name || ' · ' || trim(v_case.cause);
    ELSIF v_name = '' THEN
      v_name := trim(COALESCE(v_case.cause, ''));
    END IF;
    IF v_name = '' THEN
      v_name := '案件';
    END IF;
    v_matter := trim(COALESCE(v_case.next_action, ''));
    v_sum := v_name;
    IF v_matter <> '' THEN
      v_sum := v_sum || ' · ' || v_matter;
    END IF;
    -- iCal 转义：反斜杠、逗号、分号、换行
    v_sum := replace(replace(replace(v_sum, '\', '\\'), ',', '\,'), ';', '\;');
    v_sum := replace(v_sum, chr(10), '\n');

    v_rules := COALESCE(v_case.remind_rules, '[]'::jsonb);

    v_lines := v_lines || ('BEGIN:VEVENT'::text);
    v_lines := v_lines || ('UID:' || v_uid);
    v_lines := v_lines || ('DTSTAMP:' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISS') || 'Z');
    v_lines := v_lines || ('DTSTART:' || v_dt);
    v_lines := v_lines || ('SUMMARY:' || v_sum);
    -- 不再单列 DESCRIPTION：具体事项已并入标题，日历上不出现其它冗余内容
    -- VALARM 必须包在 VEVENT 内（RFC5545），每个非空 remind_rules 一条
    v_has_rule := false;
    IF jsonb_array_length(v_rules) > 0 THEN
      FOR v_i IN 0..jsonb_array_length(v_rules) - 1 LOOP
        v_rule := trim(COALESCE(v_rules->>v_i, ''));
        IF v_rule <> '' THEN
          v_has_rule := true;
          v_alarm := 'BEGIN:VALARM' || CRLF
            || 'ACTION:DISPLAY' || CRLF
            || 'DESCRIPTION:' || v_sum || CRLF
            || 'TRIGGER;VALUE=DURATION:-' || v_rule || CRLF
            || 'END:VALARM';
          v_lines := v_lines || v_alarm;
        END IF;
      END LOOP;
    END IF;
    -- 未设「到期提醒」→ 准时（节点时间本身）提醒一次
    IF NOT v_has_rule THEN
      v_alarm := 'BEGIN:VALARM' || CRLF
        || 'ACTION:DISPLAY' || CRLF
        || 'DESCRIPTION:' || v_sum || CRLF
        || 'TRIGGER;VALUE=DATE-TIME:' || v_dt || CRLF
        || 'END:VALARM';
      v_lines := v_lines || v_alarm;
    END IF;
    v_lines := v_lines || ('END:VEVENT'::text);
  END LOOP;

  v_lines := v_lines || ('END:VCALENDAR'::text);
  v_cal := array_to_string(v_lines, CRLF) || CRLF;
  RETURN v_cal;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calendar_ics(text) TO anon, authenticated, service_role;
