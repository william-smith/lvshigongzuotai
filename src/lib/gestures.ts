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
 * 「返回 + 翻页」组合手势，给有子 tab 的页面用（如案件详情）。
 *
 * 判定看**起手位置在不在 tab 条里**，不看屏幕坐标：
 * - 起点落在 `data-swipe-tabs` 元素内 → 左右滑 = 翻上一个/下一个 tab（左滑=下一个，右滑=上一个）
 * - 其余任何位置横向滑         → 返回
 *
 * ⚠️ 不要改用「屏幕左右边缘」判定：安卓 10+ 全面屏手势会**优先吃掉屏幕边缘的滑动**
 * （表现为滑一下直接回桌面），网页只能收到中间区域的事件，边缘方案实测不可用。
 * tab 条虽然横跨整宽，但用户在那里起手多为横向翻页意图，且不涉及系统边缘热区。
 */
export function useSwipeNavigation<T extends HTMLElement>({
  onBack,
  onPrevTab,
  onNextTab,
}: {
  onBack: () => void
  onPrevTab?: () => void
  onNextTab?: () => void
}) {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let x0 = 0
    let y0 = 0
    let t0 = 0
    let onTabs = false
    let tracking = false

    const onStart = (e: TouchEvent) => {
      tracking = false
      if (e.touches.length !== 1) return
      const node = e.target as HTMLElement | null
      if (!node || inside(node.tagName)) return
      let p: HTMLElement | null = node
      while (p && p !== el) {
        // tab 条自身可横向滚动（页签多时），这种容器我们不在这里排除，
        // 而是交由下面的 onTabs 分支识别
        if (p.scrollWidth - p.clientWidth > 8 && !p.hasAttribute('data-swipe-tabs')) return
        p = p.parentElement
      }
      tracking = true
      x0 = e.touches[0].clientX
      y0 = e.touches[0].clientY
      t0 = Date.now()
      onTabs = !!node.closest('[data-swipe-tabs]')
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
      const fast = Date.now() - t0 < 800
      if (onTabs) {
        // tab 条上：左右滑翻页签
        if (ax >= 56 && ax > ay * 1.6 && fast) {
          if (dx < 0) onNextTab?.()
          else onPrevTab?.()
        }
        return
      }
      // 其余区域：任意方向横向滑 = 返回
      if (ax >= 64 && ax > ay * 1.6 && fast) onBack()
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
  }, [onBack, onPrevTab, onNextTab])

  return ref
}
