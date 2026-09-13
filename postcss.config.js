import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default {
  plugins: {
    tailwindcss: {
      content: [
        join(__dirname, 'index.html'),
        join(__dirname, 'src/**/*.{ts,tsx}'),
      ],
      theme: {
        extend: {
          colors: {
            brand: { DEFAULT: '#1D4ED8', hover: '#1A43BE', soft: '#EFF4FF' },
            sidebar: '#0E1729',
            canvas: '#F6F7F9',
            line: '#E4E7EC',
            ink: { DEFAULT: '#0E1729', 2: '#475467', 3: '#98A2B3' },
            ok: '#067647',
            warn: '#B54708',
            danger: '#B42318',
          },
          fontFamily: {
            sans: ['Inter', 'Noto Sans SC', '-apple-system', 'Segoe UI', 'Microsoft YaHei', 'sans-serif'],
          },
          fontSize: { '2xs': ['11px', '16px'] },
          boxShadow: {
            card: '0 1px 2px rgba(16,24,40,0.05)',
            pop: '0 12px 32px rgba(16,24,40,0.16)',
          },
        },
      },
    },
    autoprefixer: {},
  },
}
