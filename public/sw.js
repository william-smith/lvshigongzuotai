// 律师工作台 Service Worker：应用壳缓存，让二次访问秒开。
// 策略：
//  - 同源静态资源（js/css/html/图片/字体）：stale-while-revalidate（先返回缓存，后台静默刷新）
//  - 导航请求（index.html）：网络优先，离线时回退已缓存的壳
//  - 跨域请求（Supabase 等）：一律放行走实时网络，敏感数据不进缓存
const CACHE = 'lw-shell-v1'
const ASSET_RE = /\.(?:js|css|html|htm|svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|eot|json)$/i

self.addEventListener('install', (event) => {
  self.skipWaiting()
  // 预缓存应用壳（best-effort：CDN 偶发非 200 不应让安装失败）
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(['/', '/index.html']).catch(() => {})),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // 只处理同源请求；跨域（Supabase / CDN）直接走网络
  if (url.origin !== self.location.origin) return

  // 导航：网络优先，失败回退缓存壳
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html'))),
    )
    return
  }

  // 静态资源：stale-while-revalidate
  if (ASSET_RE.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req)
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone()).catch(() => {})
            return res
          })
          .catch(() => cached)
        return cached || network
      }),
    )
    return
  }

  // 其余同源 GET：网络优先
})
