/**
 * 构建版本自检：发现服务器已部署更新版本时自动刷新，
 * 避免移动端 PWA 长期跑旧包、修了的 bug 看起来「没生效」。
 *
 * 与 sw.js 配合使用：SW 在新版本接管后会主动让已打开的页面重新加载；
 * 这里再兜一层——应用启动时比对 /version.json，不一致则强制刷新。
 */
declare const __APP_VERSION__: string

const BUILD_HASH = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''

export function checkAppVersion(): void {
  if (!BUILD_HASH) return
  const sw = navigator.serviceWorker
  if (!sw) return
  const run = () => {
    fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { version?: string } | null) => {
        if (d?.version && d.version !== BUILD_HASH) location.reload()
      })
      .catch(() => {})
  }
  // 等当前页面先被 SW 控制，避免和 SW 自带的 navigate 重载打架
  if (sw.controller) run()
  else sw.ready.then(() => run()).catch(() => {})
}
