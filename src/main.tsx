import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { VaultProvider } from './store/vault'
import { AmountPrivacyProvider } from './components/SecretMoney'
import { API_BASE } from './lib/data'
import { checkAppVersion } from './lib/versionCheck'
import { reloadWhenIdle } from './lib/idleReload'
import './index.css'

// 启动即比对构建版本：线上有更新则自动刷新，避免长期跑旧包
checkAppVersion()

// 最早时机与数据接口建连：省掉首次 fetch 的 DNS+TCP+TLS 握手（约一个 RTT）。
// 用 API_BASE 推导域名，换平台（CloudBase/MemFire）时自动适配，无需写死。
if (API_BASE) {
  try {
    const origin = new URL(API_BASE).origin
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = origin
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  } catch {
    /* 忽略非法 URL */
  }
}

// 注册 Service Worker：应用壳缓存，二次访问秒开。
// 仅生产 + https 注册；updateViaCache:'none' 让浏览器每次都重新校验 sw.js，避免 CDN 边缘缓存喂旧脚本。
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {})
    // 新 SW 接管后兜底重载一次，确保旧内存包被新包替换。
    // ⚠️ 必须走 reloadWhenIdle：直接 reload 会在用户正在操作时（如刚点开日期弹层）
    // 把整个页面冲掉，表现为「弹层一打开就闪退」，且只在该次部署后第一次出现。
    let reloaded = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return
      reloaded = true
      reloadWhenIdle()
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VaultProvider>
      <AmountPrivacyProvider>
        <App />
      </AmountPrivacyProvider>
    </VaultProvider>
  </React.StrictMode>,
)
