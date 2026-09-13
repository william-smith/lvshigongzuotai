import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useVault } from '../store/vault'
import { deleteIntake, saveIntake, type IntakeDraft } from '../lib/intakeOps'
import { decryptString, hasSensitive, maskSensitive } from '../lib/crypto'
import type { IntakeRow } from '../lib/types'

type Mode = 'create' | 'edit'

interface Props {
  mode: Mode
  initial: IntakeRow | null
  onClose: () => void
  onSaved: (row: IntakeRow, isNew: boolean) => void
  onDeleted?: (id: number) => void
}

interface FormState {
  client: string
  first_contact: string
  signed_at: string
  converted: boolean
  note: string
}

const emptyForm: FormState = {
  client: '',
  first_contact: '',
  signed_at: '',
  converted: false,
  note: '',
}

function toForm(c: IntakeRow | null): FormState {
  if (!c) return emptyForm
  return {
    client: c.client ?? '',
    first_contact: c.first_contact ?? '',
    signed_at: c.signed_at ?? '',
    converted: c.converted ?? false,
    note: c.note_mask ?? '',
  }
}

export function IntakeEditor({ mode, initial, onClose, onSaved, onDeleted }: Props) {
  const { key, requestUnlock } = useVault()
  const [form, setForm] = useState<FormState>(() => toForm(initial))
  const [noteChanged, setNoteChanged] = useState(false)
  const [decrypting, setDecrypting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [err, setErr] = useState('')
  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  const hasOriginalEnc = Boolean(initial?.note_enc)
  /** 原记录有密文但当前未解锁 → 编辑框里只能看到脱敏文本，改了会丢隐藏位 */
  const lockedWithSecret = hasOriginalEnc && !key

  // 解锁后把「跟踪记录」换成解密原文
  useEffect(() => {
    let cancelled = false
    if (!key || !initial?.note_enc) return
    setDecrypting(true)
    decryptString(key, initial.note_enc)
      .then((plain) => {
        if (!cancelled && plain) setForm((f) => ({ ...f, note: plain }))
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
  }, [key, initial?.note_enc])

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
      if (k === 'note') setNoteChanged(true)
      setForm((f) => ({ ...f, [k]: v }))
    }

  const trimmedNote = form.note.trim()
  const noteSensitive = hasSensitive(trimmedNote)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving || decrypting) return
    if (!form.client.trim()) {
      setErr('当事人姓名不能为空')
      firstFieldRef.current?.focus()
      return
    }
    // 有隐藏位且用户改过 → 必须解锁，否则隐藏位会永久丢失
    if (lockedWithSecret && noteChanged) {
      const go = window.confirm(
        '这段「跟踪记录」里含有加密内容，当前未解锁。\n' +
          '现在修改并保存，被隐藏的号码/证件号将无法恢复（只保留打码版）。\n\n' +
          '建议先取消，点「解锁」后再编辑。\n\n仍要继续保存吗？',
      )
      if (!go) return
    } else if (noteSensitive && !key) {
      const go = window.confirm(
        '检测到「跟踪记录」里含手机号或身份证号。\n' +
          '未解锁时只保存打码版本（如 138****5678），完整号码不会上传。\n\n是否继续保存？',
      )
      if (!go) return
    }

    setSaving(true)
    setErr('')
    try {
      const draft: IntakeDraft = {
        id: initial?.id,
        client: form.client.trim(),
        first_contact: form.first_contact || null,
        signed_at: form.signed_at || null,
        converted: form.converted,
        note: trimmedNote || null,
        noteChanged,
        originalEnc: initial?.note_enc ?? null,
      }
      const { row, isNew } = await saveIntake(draft, key, initial?.phones)
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
      await deleteIntake(initial.id)
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
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center text-ink-2 hover:bg-canvas rounded-lg md:hidden">
            <Icon name="back" className="w-4 h-4" />
          </button>
          <h2 className="text-base font-semibold flex-1">{mode === 'create' ? '新建接案' : '编辑接案'}</h2>
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
              <div className="text-sm font-medium">确认删除该接案记录？</div>
              <div className="text-xs text-ink-2 mt-1.5 leading-relaxed">
                「{initial?.client}」接案记录将被永久删除；其下关联的联系人电话会一并被数据库级联删除。
                此操作不可撤销（若已转成案件，案件本身不受影响）。
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
              {/* 当事人 */}
              <Field label="当事人" required>
                <input
                  ref={firstFieldRef}
                  value={form.client}
                  onChange={set('client')}
                  placeholder="例：张三"
                  className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                />
              </Field>

              {/* 首次接触 + 签单日 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="首次接触">
                  <input
                    type="date"
                    value={form.first_contact}
                    onChange={set('first_contact')}
                    className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                  />
                </Field>
                <Field label="签单日">
                  <input
                    type="date"
                    value={form.signed_at}
                    onChange={set('signed_at')}
                    className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                  />
                </Field>
              </div>

              {/* 已转案件 */}
              <Field label="状态">
                <label className="flex items-center gap-2.5 h-10 px-3 rounded-lg border border-line bg-canvas cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.converted}
                    onChange={(e) => setForm((f) => ({ ...f, converted: e.target.checked }))}
                    className="w-4 h-4 accent-brand"
                  />
                  <span className="text-sm">已转成案件（{form.converted ? '是' : '否'}）</span>
                </label>
              </Field>

              {/* 跟踪记录 */}
              <Field
                label="跟踪记录"
                hint={
                  decrypting
                    ? '正在解密…'
                    : key
                      ? '已解锁 · 保存时加密上传'
                      : '未解锁 · 含号码时只保存打码版'
                }
              >
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
                  value={form.note}
                  onChange={set('note')}
                  rows={5}
                  disabled={decrypting}
                  placeholder="沟通要点、案源、客户意向、报价等"
                  className="w-full px-3 py-2.5 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand resize-y min-h-[100px] leading-relaxed disabled:opacity-60"
                />
                {noteSensitive && (
                  <div className="mt-1.5 flex items-center gap-2 text-2xs flex-wrap">
                    <span className="text-ink-3">含敏感信息，将脱敏保存为：</span>
                    <span className="font-mono text-ink-2">
                      {maskSensitive(
                        trimmedNote.length > 40 ? trimmedNote.slice(0, 40) + '…' : trimmedNote,
                      )}
                    </span>
                    {!key && (
                      <button type="button" onClick={requestUnlock} className="text-brand hover:underline shrink-0">
                        解锁并加密原文
                      </button>
                    )}
                  </div>
                )}
              </Field>

              {err && <div className="text-xs text-danger bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">{err}</div>}
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
              {saving ? '保存中…' : mode === 'create' ? '创建接案' : '保存修改'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-xs text-ink-2 font-medium">
          {label}
          {required && <span className="text-danger ml-0.5">*</span>}
        </span>
        {hint && <span className="text-2xs text-ink-3">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
