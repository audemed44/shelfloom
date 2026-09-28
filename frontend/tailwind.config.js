/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Swiss palette: pure black & white with a single signal blue.
        black: '#000000',
        white: '#ffffff',
        primary: {
          DEFAULT: '#2563ff',
          50: '#eef3ff',
          100: '#dbe5ff',
          200: '#b8cbff',
          300: '#8aa9ff',
          400: '#5783ff',
          500: '#2563ff',
          600: '#0a47f0',
          700: '#0638c4',
          800: '#062e9c',
          900: '#08287a',
        },
        // Legacy accent names collapse onto the Swiss palette; red is kept as
        // a rare secondary signal (streaks, tags).
        accent: {
          DEFAULT: '#ff3b1f',
          rose: '#2563ff',
          teal: '#ffffff',
        },
        ink: {
          950: '#000000',
          900: '#050505',
          850: '#0b0b0b',
          800: '#141414',
          700: '#222222',
        },
      },
      fontWeight: {
        black: '800',
      },
      letterSpacing: {
        tighter: '-0.045em',
        tight: '-0.025em',
        widest: '0.14em',
      },
      fontFamily: {
        sans: ['Inter', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        display: ['Inter', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      // Swiss: hard edges everywhere; `full` stays for genuine dots/rings.
      borderRadius: {
        none: '0',
        DEFAULT: '0',
        sm: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
        full: '9999px',
      },
      boxShadow: {
        glow: 'none',
        card: 'none',
        lift: '0 0 0 1px #ffffff',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'grow-y': {
          '0%': { transform: 'scaleY(0)' },
          '100%': { transform: 'scaleY(1)' },
        },
        'grow-x': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
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
        'grow-y': 'grow-y 0.8s cubic-bezier(0.22, 1, 0.36, 1) both',
        'grow-x': 'grow-x 0.9s cubic-bezier(0.22, 1, 0.36, 1) both',
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
