/**
 * 文书与证据的 8 大分类。
 *
 * 分类只在应用内维护，不依赖硬盘上的子目录——
 * 因为案件目录里的文件随时增删、照片导入后还会重命名，靠目录结构反而容易乱。
 * 分类来源两种：关键词自动推断（auto）与手动改判（manual），手动优先。
 */

export interface DocCategory {
  id: number
  name: string
  /** 侧栏/树节点上的短名，窄屏用 */
  short: string
  /** 树节点小圆点的颜色类 */
  dot: string
  hint: string
}

export const DOC_CATEGORIES: DocCategory[] = [
  {
    id: 1,
    name: '法院仲裁委文件',
    short: '法院/仲裁',
    dot: 'bg-indigo-500',
    hint: '传票、受理通知、判决书、裁定书、调解书、裁决书、送达回证',
  },
  {
    id: 2,
    name: '对方证据及文书',
    short: '对方',
    dot: 'bg-rose-500',
    hint: '对方提交的证据、答辩状、反诉状',
  },
  {
    id: 3,
    name: '我方证据及文书',
    short: '我方',
    dot: 'bg-emerald-600',
    hint: '起诉状、代理词、我方证据目录、质证意见',
  },
  {
    id: 4,
    name: '法律法规、案例、参考论文',
    short: '法规案例',
    dot: 'bg-sky-500',
    hint: '法条、司法解释、类案检索结果、参考论文',
  },
  {
    id: 5,
    name: '委托授权材料',
    short: '委托授权',
    dot: 'bg-amber-500',
    hint: '委托合同、授权委托书、所函、身份证明、风险告知书',
  },
  {
    id: 6,
    name: '与客户沟通文件、会议纪要',
    short: '沟通纪要',
    dot: 'bg-teal-500',
    hint: '会谈记录、会议纪要、与当事人的沟通记录',
  },
  { id: 7, name: '保全', short: '保全', dot: 'bg-orange-500', hint: '保全申请、担保材料、查封冻结裁定' },
  { id: 8, name: '执行', short: '执行', dot: 'bg-violet-500', hint: '执行申请、财产查控、终本裁定、结案通知' },
]

export const UNCATEGORIZED: DocCategory = {
  id: 0,
  name: '未分类',
  short: '未分类',
  dot: 'bg-slate-400',
  hint: '自动规则没认出来的文件，手动归到对应类别',
}

/** 展示顺序：1-8 在前，未分类垫底 */
export const ALL_CATEGORIES: DocCategory[] = [...DOC_CATEGORIES, UNCATEGORIZED]

export function categoryOf(id: number): DocCategory {
  return ALL_CATEGORIES.find((c) => c.id === id) ?? UNCATEGORIZED
}

/**
 * 关键词规则。
 * 顺序即优先级——越具体的越靠前，避免「执行裁定书」被「裁定书」抢去法院类。
 */
const RULES: { id: number; words: string[] }[] = [
  { id: 7, words: ['保全', '担保', '查封', '冻结', '扣押'] },
  { id: 8, words: ['执行', '终本', '查控', '失信', '限高', '结案通知'] },
  {
    id: 5,
    words: ['委托', '授权', '所函', '身份证明', '身份证', '执业证', '风险告知', '收费', '律师费'],
  },
  { id: 6, words: ['纪要', '会谈', '谈话', '沟通', '会议', '笔录'] },
  { id: 4, words: ['法条', '法规', '条例', '司法解释', '案例', '判例', '论文', '释义', '理解与适用'] },
  { id: 2, words: ['答辩', '反诉', '对方', '被告提交', '被申请人'] },
  { id: 3, words: ['起诉状', '上诉状', '申诉', '代理词', '证据目录', '证据清单', '质证', '补充证据', '我方'] },
  {
    id: 1,
    words: ['传票', '受理', '应诉', '举证', '开庭', '判决', '裁定', '调解书', '裁决', '仲裁', '送达', '立案', '法院'],
  },
]

/** 按文件名推断分类；认不出返回 0（未分类） */
export function classifyByFilename(filename: string): number {
  const name = (filename || '').toLowerCase()
  for (const rule of RULES) {
    if (rule.words.some((w) => name.includes(w.toLowerCase()))) return rule.id
  }
  return 0
}

/** 常见可直接在浏览器里预览的类型 */
export function isPreviewable(filename: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|svg|pdf)$/i.test(filename)
}

export function isImage(filename: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(filename)
}

export function fmtSize(bytes?: number | null): string {
  if (!bytes && bytes !== 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
