// Cloudflare Pages Function: 把 /api/* 反向代理到 Supabase 后端。
// 浏览器只连 pages.dev（同源），由 Cloudflare 边缘节点去连 supabase.co，绕开国内 SNI 拦截。
const UPSTREAM = 'https://eossyfugqwnpqdixmvyy.supabase.co';

export async function onRequest(context) {
  try {
    const { request, params } = context;
    const url = new URL(request.url);

    // 兼容 Cloudflare catch-all 的两种行为：params.path 可能是字符串或数组
    let captured = (params && params.path) || '';
    if (Array.isArray(captured)) captured = captured.join('/');
    if (typeof captured !== 'string') captured = String(captured || '');
    if (captured.startsWith('api/')) captured = captured.slice(4);
    else if (captured === 'api') captured = '';

    const targetUrl = UPSTREAM + (captured ? '/' + captured : '') + url.search;

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-visitor');
    headers.delete('cf-ray');

    const init = { method: request.method, headers, redirect: 'manual' };
    if (!['GET', 'HEAD'].includes(request.method)) {
      init.body = await request.arrayBuffer();
    }

    const resp = await fetch(targetUrl, init);

    // 3xx 必须透传给浏览器，绝不能在这里 follow：
    // 邮箱确认 / 密码找回点开链接时，GoTrue 校验 token 后会 302 到 redirect_to，
    // 并把会话 token 放在 URL fragment（#access_token=…&type=recovery）里。
    // 若代理 follow 掉这个 302，浏览器只拿到最终的 SPA HTML、fragment 被丢弃，
    // SPA 读不到会话 → 表现为「点邮件链接后回到登录页、密码没重置」。
    if (resp.status >= 300 && resp.status < 400) {
      const h = new Headers(resp.headers);
      h.set('Access-Control-Allow-Origin', '*');
      return new Response(null, { status: resp.status, headers: h });
    }

    const buf = await resp.arrayBuffer();
    const out = new Response(buf, { status: resp.status, headers: resp.headers });
    out.headers.set('Access-Control-Allow-Origin', '*');
    out.headers.delete('content-length');
    return out;
  } catch (e) {
    const msg = e && e.stack ? e.stack : (e && e.message ? e.message : String(e));
    return new Response('PROXY_ERR: ' + msg, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' },
    });
  }
}
