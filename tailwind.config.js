/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
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
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.1)',
        pop: '0 12px 32px rgba(16,24,40,.18)',
      },
    },
  },
  plugins: [],
};
