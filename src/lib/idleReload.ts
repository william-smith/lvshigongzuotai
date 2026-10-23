/**
 * 「空闲时再整页刷新」。
 *
 * 背景：部署后新 Service Worker 接管 / 版本自检发现新包，原本会立刻 location.reload()。
 * 若此刻用户正在操作（例如刚点开日期选择弹层），整页刷新会把弹层整个冲掉，
 * 表现为「一打开就闪退」——而且只在该次部署后的第一次出现，极易被误判成控件本身的 bug。
 *
 * 策略：刷新推迟到用户静止 IDLE_MS 之后再执行；期间任何交互都重新计时。
 * 但最多只推迟到 MAX_DEFER_MS，避免用户一直在操作时永远停留在旧包上。
 */

const IDLE_MS = 5000
const MAX_DEFER_MS = 60_000
const ACTIVITY = ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const

let timer: number | null = null
let bound = false
let fired = false
let deadline = 0

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

function fire() {
  if (fired) return
  fired = true
  unbind()
  location.reload()
}

function schedule() {
  if (fired) return
  clearTimer()
  const delay = Math.max(0, Math.min(IDLE_MS, deadline - Date.now()))
  timer = window.setTimeout(fire, delay)
}

function onActivity() {
  schedule()
}

function bind() {
  if (bound) return
  bound = true
  ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
}

function unbind() {
  if (!bound) return
  bound = false
  ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity))
}

/**
 * 请求一次「空闲时刷新」。用户在操作就一直往后推，静止后才真正刷新。
 * 多处调用（SW 接管 / 版本自检）只会触发一次刷新。
 */
export function reloadWhenIdle(): void {
  if (fired) return
  if (!deadline) deadline = Date.now() + MAX_DEFER_MS
  bind()
  schedule()
}
