/**
 * 网络自查：备份/部署脚本连不上数据源时，先跑它定位问题在哪一层。
 *
 *   node scripts/diag_net.mjs
 *
 * 依次检查：代理环境变量 → DNS（A / AAAA）→ 裸 TLS 握手（IPv4 / IPv6）→ HTTP 连通性（api.supabase.com 与项目域名）。
 * 常见结论：
 *   - api.supabase.com 通、项目域名 ECONNRESET → 该项目域名被网络挡了，备份脚本传 --token 走 Management SQL 通道即可；
 *   - 全部不通且环境里有 HTTPS_PROXY → 代理没起来，或 Node 没被用来做代理（见 scripts/net-proxy.mjs）。
 */

import dns from 'node:dns/promises'
import net from 'node:net'
import tls from 'node:tls'

const ENV_REF =
  (await import('node:fs').then((fs) => {
    try {
      const txt = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
      return (txt.match(/VITE_API_BASE\s*=\s*https?:\/\/([^./]+)\./) || [])[1] || ''
    } catch {
      return ''
    }
  })) || ''

const REF = process.argv[2] || ENV_REF
if (!REF) {
  console.error('用法：node scripts/diag_net.mjs <project-ref>')
  process.exit(1)
}
const HOST = `${REF}.supabase.co`

console.log('proxy env =', {
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  https_proxy: process.env.https_proxy,
  NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY,
})

const v4 = await dns.resolve4(HOST).catch(() => [])
const v6 = await dns.resolve6(HOST).catch(() => [])
console.log(`DNS ${HOST}\n  A    = ${v4.join(', ') || '(none)'}\n  AAAA = ${v6.join(', ') || '(none)'}`)

function tryTls(family, addr) {
  return new Promise((resolve) => {
    let done = false
    const finish = (m) => {
      if (done) return
      done = true
      resolve(m)
    }
    const sock = net.connect({ host: addr, port: 443, family }, () => {
      const s = tls.connect({ socket: sock, servername: HOST }, () => {
        finish(`TLS OK   family=${family} addr=${addr} protocol=${s.getProtocol()}`)
        s.destroy()
      })
      s.on('error', (e) => finish(`TLS ERR  family=${family} addr=${addr} ${e.code || e.message}`))
      s.setTimeout(12000, () => finish(`TLS TIMEOUT family=${family} addr=${addr}`))
    })
    sock.on('error', (e) => finish(`TCP ERR  family=${family} addr=${addr} ${e.code || e.message}`))
    sock.setTimeout(12000, () => finish(`TCP TIMEOUT family=${family} addr=${addr}`))
  })
}

if (v4[0]) console.log(await tryTls(4, v4[0]))
if (v6[0]) console.log(await tryTls(6, v6[0]))

for (const u of [`https://${HOST}/rest/v1/`, 'https://api.supabase.com/v1/projects']) {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 15000)
    const r = await fetch(u, { headers: { Accept: 'application/json' }, signal: ctl.signal })
    clearTimeout(t)
    const body = await r.text()
    // 401/403 也说明链路是通的（只是没带凭据）
    console.log(`HTTP ${r.status} ${u} len=${body.length}`)
  } catch (e) {
    console.log(`HTTP FAILED ${u} ${e.message} | cause=${e.cause ? e.cause.code || e.cause.message : 'none'}`)
  }
}
