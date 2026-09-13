import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  deriveKey,
  lock as clearKey,
  persistKey,
  restoreKey,
  setVerifier as cryptoSetVerifier,
  verifyKey,
} from '../lib/crypto'

interface VaultState {
  key: CryptoKey | null
  unlocked: boolean
  ready: boolean
  busy: boolean
  error: string
  unlockOpen: boolean
  unlock: (passphrase: string, remember: boolean) => Promise<boolean>
  lock: () => void
  requestUnlock: () => void
  closeUnlock: () => void
  setVerifier: (token: string | null | undefined) => void
}

const Ctx = createContext<VaultState | null>(null)

export function VaultProvider({ children }: { children: ReactNode }) {
  const [key, setKey] = useState<CryptoKey | null>(null)
  const [verifier, setVerifierState] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [unlockOpen, setUnlockOpen] = useState(false)

  useEffect(() => {
    restoreKey()
      .then((k) => {
        if (k) setKey(k)
      })
      .finally(() => setReady(true))
  }, [])

  const setVerifier = useCallback((token: string | null | undefined) => {
    setVerifierState(token ?? null)
    cryptoSetVerifier(token)
  }, [])

  const unlock = useCallback(async (passphrase: string, remember: boolean) => {
    setBusy(true)
    setError('')
    try {
      const k = await deriveKey(passphrase)
      const ok = await verifyKey(k)
      if (!ok) {
        setError('口令不正确')
        return false
      }
      await persistKey(k, remember)
      setKey(k)
      setUnlockOpen(false)
      return true
    } catch (e) {
      setError((e as Error).message || '解锁失败')
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const lock = useCallback(() => {
    clearKey()
    setKey(null)
  }, [])

  const requestUnlock = useCallback(() => setUnlockOpen(true), [])
  const closeUnlock = useCallback(() => {
    setUnlockOpen(false)
    setError('')
  }, [])

  // 登录/刷新后，若本机「记住」的密钥已与云端的 verifier（vault_meta.verifier_enc）
  // 不匹配，说明另一台设备改过保险箱口令。自动清掉旧密钥，让解锁框重新弹出，
  // 避免「界面以为已解锁、却处处解密失败」的死局（手机端最常见）。
  useEffect(() => {
    if (!key || verifier === null) return
    let alive = true
    verifyKey(key, verifier).then((ok) => {
      if (alive && !ok) lock()
    })
    return () => {
      alive = false
    }
  }, [key, verifier, lock])

  const value = useMemo<VaultState>(
    () => ({ key, unlocked: !!key, ready, busy, error, unlockOpen, unlock, lock, requestUnlock, closeUnlock, setVerifier }),
    [key, ready, busy, error, unlockOpen, unlock, lock, requestUnlock, closeUnlock, setVerifier],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useVault(): VaultState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useVault 必须在 VaultProvider 内使用')
  return v
}
