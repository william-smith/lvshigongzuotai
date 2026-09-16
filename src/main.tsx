import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { VaultProvider } from './store/vault'
import { AmountPrivacyProvider } from './components/SecretMoney'
import { API_BASE } from './lib/data'
import './index.css'

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
