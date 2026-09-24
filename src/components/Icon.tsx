export type IconName =
  | 'home'
  | 'agent'
  | 'case'
  | 'file'
  | 'archive'
  | 'settings'
  | 'search'
  | 'lock'
  | 'unlock'
  | 'plus'
  | 'back'
  | 'more'
  | 'camera'
  | 'phone'
  | 'cloud'
  | 'device'
  | 'scale'
  | 'clock'
  | 'check'
  | 'close'
  | 'chevron'
  | 'eye'
  | 'eye-off'
  | 'shield'
  | 'logout'
  | 'money'
  | 'user'

const paths: Record<IconName, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  // 智能体：圆角方头 + 顶部天线 + 两只眼睛
  agent:
    'M5 10h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM12 10V6M10.5 6h3M9 13.5h1.5M13.5 13.5h1.5',
  case: 'M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 12h16',
  file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zM14 3v4h4M9 13h6M9 17h4',
  archive: 'M3 7h18v4H3zM5 11v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M10 15h4',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .33 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-2.72 1.14V21a2 2 0 1 1-4 0v-.11A1.6 1.6 0 0 0 7.5 19.4a1.6 1.6 0 0 0-1.77.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 3 15H3a2 2 0 1 1 0-4h.11A1.6 1.6 0 0 0 4.6 9.5a1.6 1.6 0 0 0-.33-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.11a1.6 1.6 0 0 0 2.72 1.11l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9v.11a1.6 1.6 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.11a1.6 1.6 0 0 0-1.49 1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  // 上锁：锁梁闭合，右侧有一条竖直回落到锁体的腿
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4',
  // 已开锁：锁梁只画左半段、向上翘起后断开（无回落的那条腿），一眼可辨
  unlock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 5.6-1.5',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 18l-6-6 6-6',
  more: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  camera: 'M4 8h3l1.5-2h7L17 8h3v12H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  phone: 'M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3z',
  cloud: 'M7 18h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 11.5 3.5 3.5 0 0 0 7 18z',
  device: 'M4 5h16v10H4zM8 19h8M12 15v4',
  scale: 'M12 3v18M7 21h10M4 8h16M4 8 1 14h6zM20 8l-3 6h6z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  check: 'M4 12.5 9 17.5 20 6.5',
  close: 'M6 6l12 12M18 6 6 18',
  chevron: 'M9 6l6 6-6 6',
  eye: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 5.8A10.4 10.4 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17.6 17.6 0 0 1-3.3 4M6.4 7.7A17.4 17.4 0 0 0 2 12s3.6 6.5 10 6.5c1.2 0 2.3-.2 3.3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.6-8 9-4.8-1.4-8-4.5-8-9V6zM9 12l2 2 4-4',
  logout: 'M15 17l5-5-5-5M20 12H9M12 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h6',
  money:
    'M3 8h18a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9 11.5l3 3 3-3M12 14.5V11M9.5 13h5',
  // 账户：圆形头像 + 肩线
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0',
}

export function Icon({
  name,
  className = 'w-4 h-4',
  stroke = 1.7,
}: {
  name: IconName
  className?: string
  stroke?: number
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}
