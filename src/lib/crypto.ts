/**
 * 字段级端到端加密（E2EE）
 *
 * 算法参数与 scripts/migrate_noco.py 完全一致，保证 Python 端加密的数据
 * 浏览器能解开，反之亦然：
 *   KDF : PBKDF2-HMAC-SHA256, 210000 轮, salt = 'lawyer-workbench-v1'
 *   加密 : AES-256-GCM, 12 字节随机 IV, 密文含 16 字节认证标签
 *   格式 : v1:<iv_base64>:<ciphertext_base64>
 *
 * 密钥只在浏览器内存（或用户勾选后的本机存储）中存在，永不上传服务器。
 */

export const CRYPTO_SALT = 'lawyer-workbench-v1'
export const CRYPTO_ITERATIONS = 210000
const IV_LEN = 12

const enc = new TextEncoder()
const dec = new TextDecoder()

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromB64(s: string): ArrayBuffer {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

/** Uint8Array → ArrayBuffer（绕过 TS 的 SharedArrayBuffer 联合类型） */
function ab(u: Uint8Array): ArrayBuffer {
  return u.buffer as ArrayBuffer
}

/** 主口令 → AES 密钥（PBKDF2 派生，约 200~400ms，是刻意的慢） */
export async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(CRYPTO_SALT), iterations: CRYPTO_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    true, // 必须可导出：persistKey() 需要把密钥序列化到本机存储（30 天免解锁）
    ['encrypt', 'decrypt'],
  )
}

export async function encryptString(key: CryptoKey, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ab(iv) }, key, ab(enc.encode(plain)))
  return `v1:${toB64(iv)}:${toB64(ct)}`
}

export async function decryptString(key: CryptoKey, token: string | null | undefined): Promise<string> {
  if (!token) return ''
  const parts = token.split(':')
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('密文格式不正确')
  const iv = fromB64(parts[1])
  const ct = fromB64(parts[2])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return dec.decode(plain)
}

/**
 * 口令校验串：由迁移脚本用主口令加密的一段固定明文。
 * 数据加载后由 App 注入；未注入时（老数据）退化为不校验。
 */
let VERIFIER: string | null = null
export function setVerifier(token: string | null | undefined) {
  VERIFIER = token || null
}

/**
 * 校验口令是否正确：试着解开校验串。
 * 没有校验串时退化为 true——但正常数据一定带，所以输错口令会立即被拒绝，
 * 不会出现「提示解锁成功、随后手机号全是乱码」的情况。
 */
export async function verifyKey(key: CryptoKey, verifierEnc?: string): Promise<boolean> {
  const token = verifierEnc ?? VERIFIER
  if (!token) return true
  try {
    const plain = await decryptString(key, token)
    return plain === VERIFIER_PLAIN
  } catch {
    return false
  }
}

/** 与 scripts/migrate_noco.py 的 VERIFIER_PLAIN 必须逐字一致 */
export const VERIFIER_PLAIN = 'lawyer-workbench-ok'

// ---------- 密钥在本机的留存策略 ----------
const K_SESSION = 'lw.key.session'
const K_PERSIST = 'lw.key.persist'
const PERSIST_DAYS = 30

export async function exportKeyRaw(key: CryptoKey): Promise<string> {
  return toB64(await crypto.subtle.exportKey('raw', key))
}

export async function importKeyRaw(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64(raw), { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** remember=true 存 localStorage（30 天），否则只存会话 */
export async function persistKey(key: CryptoKey, remember: boolean) {
  const raw = await exportKeyRaw(key)
  sessionStorage.setItem(K_SESSION, raw)
  if (remember) {
    localStorage.setItem(K_PERSIST, JSON.stringify({ raw, exp: Date.now() + PERSIST_DAYS * 864e5 }))
  }
}

export async function restoreKey(): Promise<CryptoKey | null> {
  const s = sessionStorage.getItem(K_SESSION)
  if (s) {
    try {
      return await importKeyRaw(s)
    } catch {
      sessionStorage.removeItem(K_SESSION)
    }
  }
  const p = localStorage.getItem(K_PERSIST)
  if (p) {
    try {
      const { raw, exp } = JSON.parse(p)
      if (exp && Date.now() > exp) {
        localStorage.removeItem(K_PERSIST)
        return null
      }
      const key = await importKeyRaw(raw)
      sessionStorage.setItem(K_SESSION, raw)
      return key
    } catch {
      localStorage.removeItem(K_PERSIST)
    }
  }
  return null
}

export function lock() {
  sessionStorage.removeItem(K_SESSION)
  localStorage.removeItem(K_PERSIST)
}

// ---------- 脱敏显示 ----------

/**
 * 手机号脱敏：13812345678 → 138****5678
 * 与 scripts/migrate_noco.py 的 mask_phone（s[:3] + '****' + s[7:]）保持一致。
 * 用 (^|\D) / (?!\d) 保证不会命中更长数字串里的片段，等价于 Python 的 lookaround。
 */
const PHONE_RE = /(^|\D)(1[3-9]\d)(\d{4})(\d{4})(?!\d)/g
/** 身份证脱敏：110101199001011234 → 110101********1234（同 Python mask_idcard） */
const IDCARD_RE = /(^|\D)(\d{6})(\d{8})([\dXx]{4})(?!\d)/g

export function maskPhone(p: string): string {
  return p.replace(PHONE_RE, '$1$2****$4')
}

export function maskIdCard(s: string): string {
  return s.replace(IDCARD_RE, '$1$2********$4')
}

/** 把一段文本里的手机号/身份证打码——这份可以明文上云，等价 Python 的 mask_text */
export function maskSensitive(t: string | null | undefined): string | null {
  if (!t) return null
  return maskIdCard(maskPhone(t))
}

/** 文本里是否含手机号或身份证（用于判断有无必须加密的内容） */
export function hasSensitive(t: string | null | undefined): boolean {
  if (!t) return false
  PHONE_RE.lastIndex = 0
  IDCARD_RE.lastIndex = 0
  return PHONE_RE.test(t) || IDCARD_RE.test(t)
}

/** 把一段文本里的手机号转成可点击的 tel: 片段（仅解锁后使用） */
export function splitPhones(text: string): { text: string; phone?: string }[] {
  const re = /1[3-9]\d{9}/g
  const out: { text: string; phone?: string }[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[0], phone: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
