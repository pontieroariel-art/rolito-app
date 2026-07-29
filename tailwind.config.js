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
        // shadcn/ui tokens
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        drift: {
          '0%':   { transform: 'translate(0, 0) rotate(0deg)' },
          '50%':  { transform: 'translate(var(--dx, 10px), -14px) rotate(8deg)' },
          '100%': { transform: 'translate(0, 0) rotate(0deg)' },
        },
        bob: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-6px)' },
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(8px) scale(.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        fadeUp: 'fadeUp .5s ease both',
        drift:  'drift 7s ease-in-out infinite',
        bob:    'bob 3.4s ease-in-out infinite',
        rise:   'rise .32s cubic-bezier(.2,.8,.3,1.15)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
