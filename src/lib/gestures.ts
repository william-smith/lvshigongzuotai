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

/** 向下滑动 → 关闭浮层/查看器（图片预览、底部弹层等） */
export function useSwipeDown<T extends HTMLElement>(onClose: () => void, enabled = true) {
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
      // 起点若在可滚动容器顶部之外（已经滚动过），不接管，让用户先把它滚回顶部
      let p: HTMLElement | null = node
      while (p && p !== el) {
        if (p.scrollHeight - p.clientHeight > 8 && p.scrollTop > 0) return
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
      const ay = Math.abs(dy)
      const ax = Math.abs(dx)
      if (dy >= 72 && ay > ax * 1.5 && Date.now() - t0 < 900) onClose()
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
  }, [onClose, enabled])

  return ref
}
