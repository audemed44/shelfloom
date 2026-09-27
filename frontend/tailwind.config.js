/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Midnight library" palette. `black` is remapped to a deep ink so the
        // many existing `bg-black` surfaces pick up the new tone automatically.
        black: '#07080c',
        white: '#f7f6f3',
        primary: {
          DEFAULT: '#8b7cff',
          50: '#f3f1ff',
          100: '#e7e3ff',
          200: '#cfc7ff',
          300: '#b3a8ff',
          400: '#9d90ff',
          500: '#8b7cff',
          600: '#6f5cf5',
          700: '#5a45dc',
          800: '#4636b0',
          900: '#352a85',
        },
        accent: {
          DEFAULT: '#f5b56b',
          rose: '#f47fb0',
          teal: '#5fd3c6',
        },
        ink: {
          950: '#07080c',
          900: '#0c0e15',
          850: '#11131c',
          800: '#161925',
          700: '#1f2331',
        },
      },
      // Softer weights/tracking than the original brutalist type scale.
      fontWeight: {
        black: '750',
      },
      letterSpacing: {
        tighter: '-0.025em',
        widest: '0.14em',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Fraunces Variable"', 'Fraunces', 'Georgia', 'serif'],
      },
      borderRadius: {
        DEFAULT: '0.375rem',
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
        full: '9999px',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(139,124,255,0.35), 0 8px 30px -8px rgba(139,124,255,0.55)',
        card: '0 10px 30px -12px rgba(0,0,0,0.8)',
        lift: '0 24px 48px -16px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.06)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(var(--tilt, 0deg))' },
          '50%': { transform: 'translateY(-10px) rotate(var(--tilt, 0deg))' },
        },
        aurora: {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(4%, -3%, 0) scale(1.08)' },
          '66%': { transform: 'translate3d(-3%, 3%, 0) scale(0.96)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'gradient-pan': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.5s ease-out both',
        'scale-in': 'scale-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-up': 'slide-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        float: 'float 6s ease-in-out infinite',
        aurora: 'aurora 22s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        'gradient-pan': 'gradient-pan 8s ease infinite',
      },
    },
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.no-scrollbar': {
          '-ms-overflow-style': 'none',
          'scrollbar-width': 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        },
      })
    },
  ],
}
