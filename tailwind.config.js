/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:      '#0A1628',
        accent:  '#00C2FF',
        success: '#00D68F',
        surface: '#0F2040',
        border:  '#1E3A5F',
        muted:   '#4A6080',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
