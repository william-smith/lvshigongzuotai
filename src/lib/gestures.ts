/**
 * 移动端手势：横向滑动返回 / 纵向下滑关闭。
 *
 * 设计原则：
 * 1. 只认单指、只看主导方向：横向手势必须明显压过竖向位移才算（ax > ay * 1.6），避免竖向滚动被误判。
 * 2. 手势有超时（800~900ms），长按后拖、慢慢挪都不算，避免误触。
 * 3. 起点落在「可横向/纵向滚动的容器」或「输入框」里时不接管，让里面的内容自己滚。
 * 4. 返回手势认两个方向——iOS 习惯「从左边缘右滑」，安卓习惯「左滑」，中英文描述也不统一，
 *    与其猜用户想怎么滑，不如两边都认；代价是两条 perform horizontal 没有第二个用途（本项目也确实没有）。
 */

import { useEffect, useRef } from 'react'

function inside(tagName: string) {
  const t = tagName
  return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT'
}

/** 横向滑动 → 返回上一页 / 关闭本页 */
export function useSwipeBack<T extends HTMLElement>(onBack: () => void, enabled = true) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    let x0 = 0
    let y0 = 0
    let t0 = 0
    let tracking = false

    const onStart = (e: TouchEvent) => {
      tracking = false
      if (e.touches.length !== 1) return
      const node = e.target as HTMLElement | null
      if (!node || inside(node.tagName)) return
      let p: HTMLElement | null = node
      while (p && p !== el) {
        if (p.scrollWidth - p.clientWidth > 8) return
        p = p.parentElement
      }
      tracking = true
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
      t0 = Date.now()
    }

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - x0
      const dy = t.clientY - y0
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      if (ax >= 64 && ax > ay * 1.6 && Date.now() - t0 < 800) onBack()
    }

    const onCancel = () => (tracking = false)

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [onBack, enabled])

  return ref
}

/**
 * 「子页签翻页」手势：**挂载元素范围内，整屏横滑都按顺序切换子页签**。
 *
 * 语义设计（案件详情页）：
 * - 详情页里横滑**只有一种含义**——按顺序切上/下一个子页签，整屏任意位置起手都算；
 * - 返回上一页改由左上角返回按钮承担（详情页容器有自己的 MobileBar / 桌面顶栏）。
 *   这样同一页面内不再有两种横滑语义，从根上杜绝「想翻页却退出去了」的歧义。
 *
 * 因此本 hook 不需要区域标记，也不区分滑动距离——只要横向主导、位移够大就翻一页。
 *
 * ⚠️ 起手于「可横向滚动容器」（如宽表格）时不接管，让原生横滚生效。
 * ⚠️ 不要改用「屏幕左右边缘」判定：安卓 10+ 全面屏手势会优先吃掉屏幕边缘的滑动。
 */
export function useSwipeTabs<T extends HTMLElement>({
  onSwipeLeft,
  onSwipeRight,
}: {
  /** 手指向左滑（dx<0） */
  onSwipeLeft?: () => void
  /** 手指向右滑（dx>0） */
  onSwipeRight?: () => void
}) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let x0 = 0
    let y0 = 0
    let tracking = false

    const onStart = (e: TouchEvent) => {
      tracking = false
      if (e.touches.length !== 1) return
      const node = e.target as HTMLElement | null
      if (!node || inside(node.tagName)) return
      // 起手在横向可滚动容器（表头/表格等）内时不接管，交给原生横滚
      let p: HTMLElement | null = node
      while (p && p !== el) {
        if (p.scrollWidth - p.clientWidth > 8) return
        p = p.parentElement
      }
      tracking = true
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
    }

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      if (!t) return
      const dx = t.clientX - x0
      const dy = t.clientY - y0
      const ax = Math.abs(dx)
      const ay = Math.abs(dy)
      // 竖向主导不算手势（避免和页面滚动打架）
      if (ax <= ay * 1.6) return
      if (ax < 40) return
      // 方向语义由调用方决定，这里只报「滑向哪边」：
      //   onSwipeRight = 手指向右（dx>0），onSwipeLeft = 手指向左（dx<0）
      if (dx > 0) onSwipeRight?.()
      else onSwipeLeft?.()
    }

    const onCancel = () => (tracking = false)

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
    }
  }, [onSwipeLeft, onSwipeRight])

  return ref
}
