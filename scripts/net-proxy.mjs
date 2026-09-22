/**
 * 联网辅助：让 Node 内置 fetch 在需要时走代理。
 *
 * 背景（踩过的坑）：Node 22 的 fetch（undici）**默认不读 HTTPS_PROXY**，
 * 而本机不少网络环境（含 V2rayN 10808）必须走代理才能出网，
 * 表现为所有表都报 `fetch failed`，很容易误判成脚本有 bug。
 *
 * 做法：启动早期探测一次数据源能不能直连——
 *   - 直连通：什么都不做，零开销；
 *   - 环境里有代理变量且直连失败：用 NODE_USE_ENV_PROXY=1 重启自己一次
 *     （Node 22.15+ 内置支持 EnvHttpProxyAgent），并用 LW_PROXY_RETRIED 防重复递归。
 *
 * 依赖: 零第三方包。
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PROBE_TIMEOUT = 8000

function proxyUrl() {
  return (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    ''
  )
}

/**
 * @param {string} probeUrl 用来试探连通性的地址（一般是 API 根地址）
 */
export async function ensureProxy(probeUrl) {
  const proxy = proxyUrl()
  // 已经在代理模式 / 已经重试过一次 → 不再折腾
  if (process.env.NODE_USE_ENV_PROXY === '1' || process.env.LW_PROXY_RETRIED === '1') return
  if (!proxy) return

  let reachable = false
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT)
    // 只要能拿到任意 HTTP 响应就算通（401/403 也说明链路是好的）
    await fetch(probeUrl, { signal: ctrl.signal })
    clearTimeout(timer)
    reachable = true
  } catch {
    reachable = false
  }
  if (reachable) return

  console.log(`→ 直连失败，检测到代理 ${proxy}，带 NODE_USE_ENV_PROXY 重启一次…`)
  // process.argv[1] 在不同启动方式下可能是 file:// URL，也可能是普通路径
  const rawScript = process.argv[1] || ''
  const scriptPath = rawScript.startsWith('file:') ? fileURLToPath(rawScript) : rawScript
  const r = spawnSync(process.execPath, [scriptPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1', LW_PROXY_RETRIED: '1' },
  })
  // 子进程已经把结果打印完了，这里只是把退出码传出去，不再重试
  process.exit(typeof r.status === 'number' ? r.status : 1)
}
