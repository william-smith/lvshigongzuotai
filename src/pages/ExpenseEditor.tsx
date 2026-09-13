import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { useVault } from '../store/vault'
import { deleteExpense, saveExpense, type ExpenseDraft } from '../lib/expenseOps'
import { decryptString, hasSensitive, maskSensitive } from '../lib/crypto'
import type { ExpenseRow } from '../lib/types'

type Mode = 'create' | 'edit'

interface Props {
  mode: Mode
  /** 新建时传 null；编辑时传该条记录 */
  initial: ExpenseRow | null
  caseId: number
  onClose: () => void
  onSaved: (row: ExpenseRow, isNew: boolean) => void
  onDeleted?: (id: number) => void
}

interface FormState {
  at: string
  direction: string
  category: string
  amount: string
  personal: string
  detail: string
}

/** NocoDB 费用表存的是「收入 / 支出」全称，历史数据里也有单字「收 / 支」，统一归一化 */
function normDirection(v?: string | null): string {
  if (!v) return '支出'
  if (v.startsWith('收')) return '收入'
  if (v.startsWith('支')) return '支出'
  return v
}

const emptyForm: FormState = {
  at: new Date().toISOString().slice(0, 10),
  direction: '支出',
  category: '',
  amount: '',
  personal: '',
  detail: '',
}

function toForm(e: ExpenseRow | null): FormState {
  if (!e) return emptyForm
  return {
    at: e.at ?? '',
    direction: normDirection(e.direction),
    category: e.category ?? '',
    amount: e.amount != null ? String(e.amount) : '',
    personal: e.personal != null ? String(e.personal) : '',
    detail: e.detail ?? '',
  }
}

export function ExpenseEditor({ mode, initial, caseId, onClose, onSaved, onDeleted }: Props) {
  const { key, requestUnlock } = useVault()
  const [form, setForm] = useState<FormState>(() => toForm(initial))
  const [detailChanged, setDetailChanged] = useState(false)
  const [decrypting, setDecrypting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [err, setErr] = useState('')
  const firstFieldRef = useRef<HTMLInputElement | null>(null)

  const hasOriginalEnc = Boolean(initial?.detail_enc)
  const lockedWithSecret = hasOriginalEnc && !key

  // 解锁后把「摘要」换成解密原文
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

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (saving || decrypting) return
    const amountNum = form.amount.trim() === '' ? null : Number(form.amount)
    if (form.amount.trim() !== '' && (amountNum === null || Number.isNaN(amountNum))) {
      setErr('开票金额必须是一个数字')
      return
    }
    const personalNum = form.personal.trim() === '' ? null : Number(form.personal)
    if (form.personal.trim() !== '' && (personalNum === null || Number.isNaN(personalNum))) {
      setErr('个人得金额必须是一个数字')
      return
    }
    if (lockedWithSecret && detailChanged) {
      const go = window.confirm(
        '这段「摘要」里含有加密信息，当前未解锁。\n' +
          '现在修改并保存，被隐藏的号码/证件号将无法恢复（只保留打码版）。\n\n' +
          '建议先取消，点「解锁」后再编辑。\n\n仍要继续保存吗？',
      )
      if (!go) return
    } else if (detailSensitive && !key) {
      const go = window.confirm(
        '检测到摘要里含手机号或身份证号。\n' +
          '未解锁时只保存打码版本（如 138****5678），完整号码不会上传。\n\n是否继续保存？',
      )
      if (!go) return
    }

    setSaving(true)
    setErr('')
    try {
      const draft: ExpenseDraft = {
        id: initial?.id,
        case_id: caseId,
        direction: form.direction || null,
        category: form.category.trim() || null,
        at: form.at || null,
        amount: amountNum,
        personal: personalNum,
        detail: trimmedDetail || null,
        detailChanged,
        originalEnc: initial?.detail_enc ?? null,
      }
      const { row, isNew } = await saveExpense(draft, key)
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
      await deleteExpense(initial.id)
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
          <h2 className="text-base font-semibold flex-1">{mode === 'create' ? '新增费用' : '编辑费用'}</h2>
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
              <div className="text-sm font-medium">确认删除这条费用记录？</div>
              <div className="text-xs text-ink-2 mt-1.5 leading-relaxed">
                该费用条目将被永久删除，此操作不可撤销。
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
              {/* 日期 + 收支 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-ink-2 font-medium mb-1.5">日期</div>
                  <input
                    ref={firstFieldRef}
                    type="date"
                    value={form.at}
                    onChange={set('at')}
                    className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                  />
                </div>
                <div>
                  <div className="text-xs text-ink-2 font-medium mb-1.5">收支方向</div>
                  <div className="flex h-10 rounded-lg border border-line overflow-hidden">
                    {['收入', '支出'].map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, direction: o }))}
                        className={`flex-1 text-sm ${
                          form.direction === o ? `bg-brand text-white font-medium` : 'bg-canvas text-ink-2 hover:bg-[#F1F3F6]'
                        }`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 分类 */}
              <div>
                <div className="text-xs text-ink-2 font-medium mb-1.5">分类</div>
                <input
                  value={form.category}
                  onChange={set('category')}
                  placeholder="例：律师费 / 诉讼费 / 差旅 / 保全费"
                  className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand"
                />
              </div>

              {/* 开票金额 + 个人得金额（字段名严格对齐 NocoDB「次1费用详情表」） */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-ink-2 font-medium mb-1.5">开票金额（元）</div>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={set('amount')}
                    placeholder="0.00"
                    className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand tabular-nums"
                  />
                </div>
                <div>
                  <div className="text-xs text-ink-2 font-medium mb-1.5">个人得金额（元）</div>
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={form.personal}
                    onChange={set('personal')}
                    placeholder="选填"
                    className="w-full h-10 px-3 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand tabular-nums"
                  />
                </div>
              </div>

              {/* 摘要 */}
              <div>
                <div className="flex items-baseline gap-1.5 mb-1.5">
                  <span className="text-xs text-ink-2 font-medium">摘要</span>
                  <span className="text-2xs text-ink-3">
                    {decrypting ? '正在解密…' : key ? '已解锁 · 保存时加密上传' : '未解锁 · 含号码时只保存打码版'}
                  </span>
                </div>
                {lockedWithSecret && (
                  <div className="mb-2 flex items-start gap-2 rounded-lg bg-[#FFFAEB] border border-[#FEDF89] px-3 py-2">
                    <Icon name="lock" className="w-3.5 h-3.5 text-warn mt-0.5 shrink-0" />
                    <div className="text-2xs text-warn leading-relaxed flex-1">
                      这段摘要含加密信息，当前显示的是打码版。
                      <button type="button" onClick={requestUnlock} className="underline ml-1 font-medium">
                        解锁后可查看与编辑完整内容
                      </button>
                    </div>
                  </div>
                )}
                <textarea
                  value={form.detail}
                  onChange={set('detail')}
                  rows={3}
                  disabled={decrypting}
                  placeholder="付款对象、用途、对方账户等（含当事人隐私时自动加密）"
                  className="w-full px-3 py-2.5 rounded-lg border border-line bg-canvas text-sm outline-none focus:bg-white focus:border-brand resize-y min-h-[72px] leading-relaxed disabled:opacity-60"
                />
                {detailSensitive && (
                  <div className="mt-1.5 flex items-center gap-2 text-2xs flex-wrap">
                    <span className="text-ink-3">含敏感信息，将脱敏保存为：</span>
                    <span className="font-mono text-ink-2">
                      {maskSensitive(trimmedDetail.length > 40 ? trimmedDetail.slice(0, 40) + '…' : trimmedDetail)}
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
              {saving ? '保存中…' : mode === 'create' ? '创建费用' : '保存修改'}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}
