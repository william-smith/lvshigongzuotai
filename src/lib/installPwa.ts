// PWA 安装：统一处理安卓（beforeinstallprompt 原生安装）与 iOS（分享→添加到主屏幕引导）。

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let handlers: (() => void)[] = []

/** 捕获安卓 beforeinstallprompt（只在尚未安装、且浏览器支持时触发） */
export function initInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    handlers.forEach((h) => h())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    handlers.forEach((h) => h())
  })
}

/** 订阅安装事件（组件挂载时用），返回取消订阅 */
export function onInstallPrompt(cb: () => void): () => void {
  handlers.push(cb)
  return () => {
    handlers = handlers.filter((h) => h !== cb)
  }
}

/** 是否有可触发的安卓原生安装 */
export function canPrompt(): boolean {
  return deferred !== null
}

/** 触发安卓原生安装；返回是否成功触发 */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  try {
    await deferred.prompt()
    const choice = await deferred.userChoice
    if (choice.outcome === 'accepted') {
      deferred = null
    }
    return choice.outcome === 'accepted'
  } catch {
    return false
  }
}

/** 是否已在独立窗口运行（已安装/已添加到主屏幕） */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari 添加到主屏幕后 navigator.standalone 为 true
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/** 是否 iOS 设备（需要走「分享→添加到主屏幕」引导，安卓原生 prompt 不可用） */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** 安装提示的「不再提示」记忆 */
const DISMISS_KEY = 'lw.pwa.install.dismissed'
export function installDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
export function setInstallDismissed(v: boolean): void {
  try {
    if (v) localStorage.setItem(DISMISS_KEY, '1')
    else localStorage.removeItem(DISMISS_KEY)
  } catch {
    /* 隐私模式等忽略 */
  }
}
