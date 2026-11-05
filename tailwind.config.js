/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        crimson: {
          DEFAULT: '#C8102E',
          dark: '#9E0C24',
        },
        navy: {
          DEFAULT: '#1B2A4A',
          deep: '#101D33',
        },
        ink: {
          DEFAULT: '#14253D',
          deep: '#0E1A2B',
        },
        workspace: '#F1F5F9',
        aadi: {
          DEFAULT: '#F47721',
          dark: '#DC6412',
        },
        aadigreen: '#16A45B',
        gold: '#C9A66B',
        line: '#E2E8F0',
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)',
        pop: '0 12px 32px rgba(16,24,40,.18)',
        soft: '0 1px 2px rgba(20,37,61,.04), 0 8px 24px -16px rgba(20,37,61,.18)',
        lift: '0 18px 40px -24px rgba(20,37,61,.35), 0 4px 12px -6px rgba(20,37,61,.12)',
        glass: '0 24px 60px -28px rgba(14,26,43,.45), inset 0 1px 0 rgba(255,255,255,.9)',
      },
    },
  },
  plugins: [],
};
