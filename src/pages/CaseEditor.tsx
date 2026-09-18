import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useVault } from '../store/vault'
import { deleteCase, saveCase, type CaseDraft } from '../lib/caseOps'
import { decryptString, hasSensitive, maskSensitive } from '../lib/crypto'
import { useSwipeBack } from '../lib/gestures'
import { defaultAt, toDateTimeLocal, type CaseRow } from '../lib/types'

type Mode = 'create' | 'edit'

const STAGE_PRESETS = ['一审', '仲裁', '二审', '再审', '执行', '调解', '结案', '解除委托'] as const

interface Props {
  mode: Mode
  initial: CaseRow | null
  onClose: () => void
  onSaved: (row: CaseRow, isNew: boolean) => void
  onDeleted?: (id: number) => void
}

interface FormState {
  client: string
  cause: string
  stage: string
  next_action: string
  next_due: string
  first_contact: string
  signed_at: string
  detail: string
}

const emptyForm: FormState = {
  client: '',
  cause: '',
  stage: '一审',
  next_action: '',
  next_due: defaultAt(),
  first_contact: '',
  signed_at: '',
  detail: '',
}

function toForm(c: CaseRow | null): FormState {
  if (!c) return emptyForm
  return {
    client: c.client ?? '',
    cause: c.cause ?? '',
    stage: c.stage ?? '一审',
    next_action: c.next_action ?? '',
    next_due: toDateTimeLocal(c.next_due),
    first_contact: c.first_contact ?? '',
    signed_at: c.signed_at ?? '',
    // 先放脱敏文本；解锁后会用密文解出的原文替换
    detail: c.detail_mask ?? '',
  }
}

export function CaseEditor({ mode, initial, onClose, onSaved, onDeleted }: Props) {
  const { key, requestUnlock } = useVault()
  const [form, setForm] = useState<FormState>(() => toForm(initial))
  const [detailChanged, setDetailChanged] = useState(false)
  const [decrypting, setDecrypting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [err, setErr] = useState('')
  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  const hasOriginalEnc = Boolean(initial?.detail_enc)
  /** 原记录有密文但当前未解锁 → 编辑框里只能看到脱敏文本，改了会丢隐藏位 */
  const lockedWithSecret = hasOriginalEnc && !key

  // 解锁后把「详细情况」换成解密原文
  useEffect(() => {
    let cancelled = false
    if (!key || !initial?.detail_enc) return
    setDecrypting(true)
    decryptString(key, initial.detail_enc)
      .then((plain) => {
        if (!cancelled && plain) setForm((f) => ({ ...f, detail: plain }))
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
  }, [key, initial?.detail_enc])

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
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const v = e.target.value
      if (k === 'detail') setDetailChanged(true)
      setForm((f) => ({ ...f, [k]: v }))
    }

  const trimmedDetail = form.detail.trim()
  const detailSensitive = hasSensitive(trimmedDetail)
  const stageNeedsCustom = !STAGE_PRESETS.includes(form.stage as (typeof STAGE_PRESETS)[number])

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving || decrypting) return
    if (!form.client.trim()) {
      setErr('委托人姓名不能为空')
      firstFieldRef.current?.focus()
      return
    }
    // 有隐藏位且用户改过 → 必须解锁，否则隐藏位会永久丢失
    if (lockedWithSecret && detailChanged) {
      const go = window.confirm(
        '这段「详细情况」里含有加密内容，当前未解锁。\n' +
          '现在修改并保存，被隐藏的号码/证件号将无法恢复（只保留打码版）。\n\n' +
          '建议先取消，点「解锁」后再编辑。\n\n仍要继续保存吗？',
      )
      if (!go) return
    } else if (detailSensitive && !key) {
      const go = window.confirm(
        '检测到「详细情况」里含手机号或身份证号。\n' +
          '未解锁时只保存打码版本（如 138****5678），完整号码不会上传。\n\n是否继续保存？',
      )
      if (!go) return
    }

    setSaving(true)
    setErr('')
    try {
      const draft: CaseDraft = {
        id: initial?.id,
        client: form.client.trim(),
        cause: form.cause.trim(),
        stage: form.stage.trim(),
        next_action: form.next_action.trim() || null,
        next_due: form.next_due || null,
        first_contact: form.first_contact || null,
        signed_at: form.signed_at || null,
        detail: trimmedDetail || null,
        detailChanged,
        originalEnc: initial?.detail_enc ?? null,
      }
      const { row, isNew } = await saveCase(draft, key)
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
      await deleteCase(initial.id)
      onDeleted?.(initial.id)
    } catch (e) {
      setErr((e as Error).message || '删除失败')
    } finally {
      setSaving(false)
      setConfirmDelete(false)
    }
  }

  // 移动端：横向滑动关闭编辑页
  const swipeRef = useSwipeBack<HTMLFormElement>(onClose)

  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-ink/40 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />
      <form
        ref={swipeRef}
        onSubmit={submit}
        className="relative w-full md:max-w-xl bg-white md:rounded-2xl rounded-t-2xl shadow-pop flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* 顶栏 */}
        <div className="flex items-center gap-2 h-14 px-4 md:px-5 border-b border-line shrink-0">
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center text-ink-2 hover:bg-canvas rounded-lg md:hidden">
            <Icon name="back" className="w-4 h-4" />
          </button>
          <h2 className="text-base font-semibold flex-1">{mode === 'create' ? '新建案件' : '编辑案件'}</h2>
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
              <div className="text-sm font-medium">确认删除该案件？</div>
              <div className="text-xs text-ink-2 mt-1.5 leading-relaxed">
                「{initial?.client}」案件将被永久删除；其下关联的时间线、费用、材料将一并被数据库级联删除（on delete cascade）。
                此操作不可撤销。
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
              {/* 委托人 */}
              <Field label="委托人" required>
                <input
                  ref={firstFieldRef}
                  value={form.client}
                  onChange={set('client')}
                  placeholder="例：张三"
                  className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                />
              </Field>

              {/* 案由 */}
              <Field label="案由">
                <input
                  value={form.cause}
                  onChange={set('cause')}
                  placeholder="例：劳动争议、工伤赔偿、交通事故"
                  className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                />
              </Field>

              {/* 阶段 */}
              <Field label="阶段">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {STAGE_PRESETS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, stage: s }))}
                      className={`h-7 px-2.5 rounded-md text-xs border ${
                        form.stage === s
                          ? 'bg-brand text-white border-brand'
                          : 'bg-white text-ink-2 border-line hover:border-ink-3'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <input
                  value={stageNeedsCustom ? form.stage : ''}
                  onChange={set('stage')}
                  placeholder="或自定义阶段"
                  className="w-full h-9 px-3 rounded-lg border border-line bg-canvas text-xs outline-none focus:bg-white focus:border-brand"
                />
              </Field>

              {/* 下一节点 + 日期 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="下一节点">
                  <input
                    value={form.next_action}
                    onChange={set('next_action')}
                    placeholder="例：提交答辩状、申请开庭"
                    className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                  />
                </Field>
                <Field label="节点时间（精确到分钟，默认 09:00）">
                  <input
                    type="datetime-local"
                    value={form.next_due}
                    onChange={set('next_due')}
                    className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                  />
                </Field>
              </div>

              {/* 签单日 + 首次接触 */}
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

              {/* 详细情况 */}
              <Field
                label="详细情况"
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
                  value={form.detail}
                  onChange={set('detail')}
                  rows={5}
                  disabled={decrypting}
                  placeholder="案情概要、当事人诉求、风险点等"
                  className="w-full px-3 py-2.5 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand resize-y min-h-[100px] leading-relaxed disabled:opacity-60"
                />
                {detailSensitive && (
                  <div className="mt-1.5 flex items-center gap-2 text-2xs flex-wrap">
                    <span className="text-ink-3">含敏感信息，将脱敏保存为：</span>
                    <span className="font-mono text-ink-2">
                      {maskSensitive(
                        trimmedDetail.length > 40 ? trimmedDetail.slice(0, 40) + '…' : trimmedDetail,
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
              {saving ? '保存中…' : mode === 'create' ? '创建案件' : '保存修改'}
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
