import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useVault } from '../store/vault'
import { deleteTimeline, saveTimeline, type TimelineDraft } from '../lib/timelineOps'
import { decryptString, hasSensitive, maskSensitive } from '../lib/crypto'
import type { TimelineRow } from '../lib/types'

type Mode = 'create' | 'edit'

interface Props {
  mode: Mode
  /** 新建时传 null；编辑时传该条记录 */
  initial: TimelineRow | null
  caseId: number
  onClose: () => void
  onSaved: (row: TimelineRow, isNew: boolean) => void
  onDeleted?: (id: number) => void
}

interface FormState {
  at: string
  content: string
}

/** 新建节点默认时间：今天 09:00（取本地时区，datetime-local 直接吃这个值） */
function defaultAt(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`
}

/** 把任意 at 字符串规整成 datetime-local 接受的 `YYYY-MM-DDTHH:MM`：
 *  - 旧数据只有日期（如 2026-03-11）→ 补足 09:00
 *  - 带秒/时区（如 2026-03-11T09:00:00.000Z）→ 只截到分钟 */
function toDateTimeLocal(s: string | null | undefined): string {
  if (!s) return ''
  const [datePart, timePart = ''] = s.split('T')
  const time = timePart ? timePart.slice(0, 5) : '09:00'
  return `${datePart}T${time}`
}

const emptyForm: FormState = { at: defaultAt(), content: '' }

function toForm(t: TimelineRow | null): FormState {
  if (!t) return emptyForm
  return {
    at: toDateTimeLocal(t.at),
    content: t.content_mask ?? '',
  }
}

export function TimelineEditor({ mode, initial, caseId, onClose, onSaved, onDeleted }: Props) {
  const { key, requestUnlock } = useVault()
  const [form, setForm] = useState<FormState>(() => toForm(initial))
  const [contentChanged, setContentChanged] = useState(false)
  const [decrypting, setDecrypting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [err, setErr] = useState('')
  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  const hasOriginalEnc = Boolean(initial?.content_enc)
  const lockedWithSecret = hasOriginalEnc && !key

  // 解锁后把「内容」换成解密原文
  useEffect(() => {
    let cancelled = false
    if (!key || !initial?.content_enc) return
    setDecrypting(true)
    decryptString(key, initial.content_enc)
      .then((plain) => {
        if (!cancelled && plain) setForm((f) => ({ ...f, content: plain }))
      })
      .catch(() => {
        /* 解不开就保持脱敏文本 */
      })
      .finally(() => {
        if (!cancelled) setDecrypting(false)
      })
    return () => {
      cancelled = true
    }
  }, [key, initial?.content_enc])

  // ESC 关闭
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(() => {
    firstFieldRef.current?.focus()
  }, [])

  const set =
    (k: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const v = e.target.value
      if (k === 'content') setContentChanged(true)
      setForm((f) => ({ ...f, [k]: v }))
    }

  const trimmedContent = form.content.trim()
  const contentSensitive = hasSensitive(trimmedContent)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving || decrypting) return
    if (!trimmedContent) {
      setErr('内容不能为空')
      firstFieldRef.current?.focus()
      return
    }
    if (lockedWithSecret && contentChanged) {
      const go = window.confirm(
        '这段「内容」里含有加密信息，当前未解锁。\n' +
          '现在修改并保存，被隐藏的号码/证件号将无法恢复（只保留打码版）。\n\n' +
          '建议先取消，点「解锁」后再编辑。\n\n仍要继续保存吗？',
      )
      if (!go) return
    } else if (contentSensitive && !key) {
      const go = window.confirm(
        '检测到内容里含手机号或身份证号。\n' +
          '未解锁时只保存打码版本（如 138****5678），完整号码不会上传。\n\n是否继续保存？',
      )
      if (!go) return
    }

    setSaving(true)
    setErr('')
    try {
      const draft: TimelineDraft = {
        id: initial?.id,
        case_id: caseId,
        at: form.at || null,
        content: trimmedContent || null,
        contentChanged,
        originalEnc: initial?.content_enc ?? null,
      }
      const { row, isNew } = await saveTimeline(draft, key)
      onSaved(row, isNew)
    } catch (e) {
      setErr((e as Error).message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!initial?.id) return
    setSaving(true)
    setErr('')
    try {
      await deleteTimeline(initial.id)
      onDeleted?.(initial.id)
    } catch (e) {
      setErr((e as Error).message || '删除失败')
    } finally {
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-ink/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <form
        onSubmit={submit}
        className="relative w-full md:max-w-xl bg-white md:rounded-2xl rounded-t-2xl shadow-pop flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* 顶栏 */}
        <div className="flex items-center gap-2 h-14 px-4 md:px-5 border-b border-line shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-ink-2 hover:bg-canvas rounded-lg md:hidden"
          >
            <Icon name="back" className="w-4 h-4" />
          </button>
          <h2 className="text-base font-semibold flex-1">{mode === 'create' ? '新增时间线' : '编辑时间线'}</h2>
          {mode === 'edit' && !confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-danger hover:bg-[#FEF2F2] px-2.5 h-8 rounded-lg flex items-center gap-1"
            >
              <Icon name="close" className="w-3.5 h-3.5" />
              删除
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="hidden md:flex w-8 h-8 items-center justify-center text-ink-2 hover:bg-canvas rounded-lg"
            aria-label="关闭"
          >
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>

        {/* 表单 */}
        <div className="flex-1 overflow-y-auto px-4 md:px-5 py-4 space-y-4">
          {confirmDelete ? (
            <div className="py-2">
              <div className="text-sm font-medium">确认删除这条时间线记录？</div>
              <div className="text-xs text-ink-2 mt-1.5 leading-relaxed">
                该时间线条目将被永久删除，此操作不可撤销。
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="h-9 px-3.5 rounded-lg border border-line text-sm text-ink-2 hover:bg-canvas"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={doDelete}
                  disabled={saving}
                  className="h-9 px-3.5 rounded-lg bg-danger text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? '删除中…' : '确认删除'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <div className="text-xs text-ink-2 font-medium mb-1.5">时间（精确到分钟，默认 09:00）</div>
                <input
                  ref={firstFieldRef}
                  type="datetime-local"
                  value={form.at}
                  onChange={set('at')}
                  className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                />
              </div>

              <div>
                <div className="flex items-baseline gap-1.5 mb-1.5">
                  <span className="text-xs text-ink-2 font-medium">内容</span>
                  <span className="text-danger">*</span>
                  <span className="text-2xs text-ink-3">
                    {decrypting ? '正在解密…' : key ? '已解锁 · 保存时加密上传' : '未解锁 · 含号码时只保存打码版'}
                  </span>
                </div>
                {lockedWithSecret && (
                  <div className="mb-2 flex items-start gap-2 rounded-lg bg-[#FFFAEB] border border-[#FEDF89] px-3 py-2">
                    <Icon name="lock" className="w-3.5 h-3.5 text-warn mt-0.5 shrink-0" />
                    <div className="text-2xs text-warn leading-relaxed flex-1">
                      这段内容含加密信息，当前显示的是打码版。
                      <button type="button" onClick={requestUnlock} className="underline ml-1 font-medium">
                        解锁后可查看与编辑完整内容
                      </button>
                    </div>
                  </div>
                )}
                <textarea
                  value={form.content}
                  onChange={set('content')}
                  rows={6}
                  disabled={decrypting}
                  placeholder="例：2026-03-11 发出被迫解除劳动合同通知书（EMS）"
                  className="w-full px-3 py-2.5 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand resize-y min-h-[120px] leading-relaxed disabled:opacity-60"
                />
                {contentSensitive && (
                  <div className="mt-1.5 flex items-center gap-2 text-2xs flex-wrap">
                    <span className="text-ink-3">含敏感信息，将脱敏保存为：</span>
                    <span className="font-mono text-ink-2">
                      {maskSensitive(trimmedContent.length > 40 ? trimmedContent.slice(0, 40) + '…' : trimmedContent)}
                    </span>
                    {!key && (
                      <button type="button" onClick={requestUnlock} className="text-brand hover:underline shrink-0">
                        解锁并加密原文
                      </button>
                    )}
                  </div>
                )}
              </div>

              {err && (
                <div className="text-xs text-danger bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">{err}</div>
              )}
            </>
          )}
        </div>

        {/* 底栏 */}
        {!confirmDelete && (
          <div className="flex items-center gap-2 h-16 px-4 md:px-5 border-t border-line bg-white shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-lg border border-line text-sm text-ink-2 hover:bg-canvas"
            >
              取消
            </button>
            <div className="flex-1" />
            <button
              type="submit"
              disabled={saving}
              className="h-10 px-5 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
              {saving ? '保存中…' : mode === 'create' ? '创建时间线' : '保存修改'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
