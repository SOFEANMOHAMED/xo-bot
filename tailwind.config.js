/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        blink: 'blink 1.1s ease-in-out infinite',
      },
      colors: {
        brand: {
          DEFAULT: '#FF9A00',
          50: '#FFF8EB',
          100: '#FFEFCC',
          200: '#FFDB99',
          300: '#FFC266',
          400: '#FFAD33',
          500: '#FF9A00',
          600: '#E68A00',
          700: '#CC7A00',
          800: '#995C00',
          900: '#663D00',
        },
        gray: {
          900: '#111827',
          800: '#1f2937',
        },
      },
      fontFamily: {
        sans: ['Cairo', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
