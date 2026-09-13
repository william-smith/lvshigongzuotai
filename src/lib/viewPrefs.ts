import { useEffect, useState } from 'react'

/**
 * 列表页偏好持久化（筛选 / 排序）。
 * 存 localStorage，命名空间 lw.prefs.v1，按 key 区分页面（如 'cases'、'intakes'）。
 * 只记筛选与排序 —— 搜索关键词不记（否则下次打开是空列表，容易被误认为数据丢了）。
 */
const NS = 'lw.prefs.v1'

function read<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(`${NS}.${key}`)
    if (!raw) return null
    const v = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Partial<T>) : null
  } catch {
    return null
  }
}

export function useViewPref<T extends object>(key: string, defaults: T) {
  const [state, setState] = useState<T>(() => ({ ...defaults, ...(read<T>(key) ?? {}) }))

  useEffect(() => {
    try {
      localStorage.setItem(`${NS}.${key}`, JSON.stringify(state))
    } catch {
      // 隐私模式 / 配额满：忽略，不阻塞使用
    }
  }, [key, state])

  const reset = () => setState({ ...defaults })
  const isDefault = (Object.keys(defaults) as (keyof T)[]).every((k) => state[k] === defaults[k])

  return { view: state, setView: setState, patch: (p: Partial<T>) => setState((s) => ({ ...s, ...p })), reset, isDefault }
}
