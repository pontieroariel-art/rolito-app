/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:           '#111110',
        accent:       '#1D9E75',
        success:      '#1D9E75',
        surface:      '#1C1C1A',
        border:       '#2C2C2A',
        muted:        '#888780',
        'warm-bg':    '#F1EFE8',
        'warm-border':'#D3D1C7',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
