/**
 * 唤起第三方扫描 App（扫描全能王 CamScanner）。
 *
 * 重要限制（浏览器生态决定的，不是实现问题）：
 * 1. 网页**无法事先查询**手机上装没装某个 App，只能「试着跳一下」，再看页面有没有失焦来反推。
 * 2. 网页**拿不到扫描结果**。CamScanner 官方的第三方调用走 Android 原生
 *    `startActivityForResult`（ACTION_SCAN + 文件路径参数），浏览器没有这个通道；
 *    Chrome 的 intent URI 只能「唤起」，不能「带结果返回」。
 *    所以用户扫完后要自己回到本页导入，本组件负责把这个流程讲清楚。
 * 3. Android 的 intent URI 在对方未安装时什么都不发生，正好便于我们接管提示；
 *    iOS 若 scheme 未被支持，系统可能弹「Safari 打不开该网页」，属正常现象。
 */

import { Icon } from './Icon'

/** 应用市场条目 */
export type AppStore = { id: string; name: string; url: string; recommend?: boolean }

/**
 * 各应用市场入口。**刻意不绑死 Google Play**——国内机器多是华为 / 荣耀 / 小米 / OPPO / vivo
 * 自带市场，装没装 Play 都不一定。规则：
 * - 能确定搜索深链的（苹果 App Store、Google Play）直接带关键词搜索；
 * - 其余厂商网页端没有公开稳定的搜索深链（多为 SPA hash 路由，改版即失效），
 *   只给官网首页，宁可让用户进市场里搜一次，也不给打不开的链接；
 * - Android 另给 `market://search?q=`：交给**本机默认应用市场**接管的通用方案，
 *   华为 / 荣耀 / 小米 / OPPO / vivo 都会响应，不依赖任何具体商店。
 */
const STORE_DEFS: Record<string, { name: string; build: (kw: string) => string }> = {
  apple: { name: 'App Store', build: (kw) => `https://apps.apple.com/cn/search?term=${kw}` },
  market: { name: '本机应用市场', build: (kw) => `market://search?q=${kw}` },
  huawei: { name: '华为应用市场', build: () => 'https://appgallery.huawei.com/' },
  honor: { name: '荣耀应用市场', build: () => 'https://www.honor.com/cn/tech/honor-app-market/' },
  xiaomi: { name: '小米应用商店', build: () => 'https://app.mi.com/' },
  oppo: { name: 'OPPO 软件商店', build: () => 'https://store.oppomobile.com/' },
  vivo: { name: 'vivo 应用商店', build: () => 'https://app.vivo.com.cn/' },
  google: { name: 'Google Play', build: (kw) => `https://play.google.com/store/search?q=${kw}&c=apps` },
  yyb: { name: '应用宝', build: () => 'https://sj.qq.com/' },
}

/** 粗略识别手机品牌，只用来把最可能的市场排在最前，不据此屏蔽其它市场 */
export function detectBrand(): string {
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return 'apple'
  if (/HarmonyOS|HUAWEI|Huawei/i.test(ua)) return 'huawei'
  if (/HONOR|Honor/i.test(ua)) return 'honor'
  if (/Xiaomi|Redmi|POCO/i.test(ua)) return 'xiaomi'
  if (/OPPO|realme/i.test(ua)) return 'oppo'
  if (/vivo/i.test(ua)) return 'vivo'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}

const BRAND_FIRST: Record<string, string[]> = {
  apple: ['apple'],
  huawei: ['market', 'huawei', 'yyb', 'google'],
  honor: ['market', 'honor', 'huawei', 'yyb', 'google'],
  xiaomi: ['market', 'xiaomi', 'yyb', 'google'],
  oppo: ['market', 'oppo', 'yyb', 'google'],
  vivo: ['market', 'vivo', 'yyb', 'google'],
  android: ['market', 'yyb', 'huawei', 'honor', 'xiaomi', 'google'],
  other: ['apple', 'google', 'huawei', 'honor', 'xiaomi', 'yyb'],
}

/** 按本机品牌排序的应用市场列表，供「未安装」时就地提示使用 */
export function appStores(keyword: string): AppStore[] {
  const kw = encodeURIComponent(keyword || '')
  const order = BRAND_FIRST[detectBrand()] || BRAND_FIRST.other
  const seen = new Set<string>()
  const out: AppStore[] = []
  order.forEach((id, idx) => {
    if (seen.has(id)) return
    const def = STORE_DEFS[id]
    if (!def) return
    seen.add(id)
    out.push({ id, name: def.name, url: def.build(kw), recommend: idx === 0 })
  })
  return out
}

type Platform = 'ios' | 'android' | 'other'

function detectPlatform(): Platform {
  const ua = navigator.userAgent || ''
  if (/Android/i.test(ua)) return 'android'
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (navigator.platform === 'MacIntel' && (navigator as { maxTouchPoints?: number }).maxTouchPoints! > 1) return 'ios'
  return 'other'
}

// 候选唤起地址，按顺序尝试。前两项来自第三方整理的 scheme 资料，官方未公开承诺，
// 失效时由最后一项（包名/纯 scheme）兜底；全都失败就交由本组件的提示页接管。
const CANDIDATES: Record<Platform, string[]> = {
  android: [
    'intent://scan/#Intent;scheme=camscanner;package=com.intsig.camscanner;end',
    'intent://open/#Intent;package=com.intsig.camscanner;end',
  ],
  ios: ['camscanner://pro/invokeCamera', 'camscanner://'],
  other: ['camscanner://'],
}

function fire(url: string, platform: Platform) {
  if (platform === 'ios') {
    // iOS 用隐藏 iframe 触发，尽量规避 scheme 不支持时整页跳转报「打不开网页」
    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = url
    document.body.appendChild(iframe)
    setTimeout(() => iframe.remove(), 1200)
  } else {
    const a = document.createElement('a')
    a.href = url
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    setTimeout(() => a.remove(), 1200)
  }
}

/** 尝试单次唤起，返回是否「看起来已经跳走了」 */
function tryOnce(url: string, platform: Platform, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('blur', onHide)
      resolve(ok)
    }
    const onHide = () => {
      if (document.hidden) finish(true)
    }
    const timer = setTimeout(() => finish(false), timeout)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('blur', onHide)
    fire(url, platform)
  })
}

/**
 * 依次尝试唤起扫描全能王。
 * @returns true 表示已跳走（大概率装了），false 表示没能唤起（交给调用方提示）
 */
export async function openCamScanner(): Promise<boolean> {
  const platform = detectPlatform()
  for (const url of CANDIDATES[platform]) {
    if (await tryOnce(url, platform, 1200)) return true
  }
  return false
}

/** 通用：尝试用任意 scheme 唤起本机 App，返回是否「看起来跳走了」。供自定义扫描 App 复用。 */
export async function openScheme(url: string): Promise<boolean> {
  const platform = detectPlatform()
  return tryOnce(url, platform, 1200)
}

/** 推荐的应用市场地址（按本机品牌猜，猜不出给通用兜底）。旧接口，保留兼容。 */
export function ScanStoreUrl(keyword = 'camscanner') {
  return (
    appStores(keyword)[0]?.url ||
    `https://play.google.com/store/search?q=${encodeURIComponent(keyword)}&c=apps`
  )
}

export function ScanFallbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  const platform = detectPlatform()
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-pop p-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="w-9 h-9 rounded-lg bg-brand-soft text-brand flex items-center justify-center">
            <Icon name="camera" className="w-4.5 h-4.5" />
          </span>
          <h2 className="text-base font-semibold text-ink">未能打开扫描全能王</h2>
        </div>
        <p className="text-xs text-ink-2 leading-relaxed mb-3">
          手机上可能没有安装扫描全能王，或系统拦下了跳转。装好后本按钮会直接跳过去，
          你在那边扫完再回到本页导入即可。
        </p>
        <ul className="text-2xs text-ink-3 leading-relaxed mb-4 space-y-1 list-disc pl-4">
          <li>网页无法接收别的应用扫完的文件，所以没有「扫完自动回来」这一步</li>
          <li>若手机其实已装，多在弹窗里点一次「允许打开」即可</li>
          <li>{platform === 'ios' ? 'iOS 需在 Safari 或主屏方式打开本页才能跳转第三方应用' : '安卓可在应用市场搜索「扫描全能王」安装'}</li>
        </ul>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-10 rounded-lg border border-line text-sm text-ink-2 hover:bg-canvas"
          >
            知道了
          </button>
          <a
            href={ScanStoreUrl()}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
            className="flex-1 h-10 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover flex items-center justify-center"
          >
            去安装
          </a>
        </div>
      </div>
    </div>
  )
}
