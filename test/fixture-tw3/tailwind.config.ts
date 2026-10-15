import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.html'],
  darkMode: 'media',
  theme: { extend: { colors: { brand: { DEFAULT: '#123456', light: '#abcdef' } } } },
  plugins: [],
}
export default config
