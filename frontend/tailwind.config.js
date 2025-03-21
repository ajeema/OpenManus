/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'dark-bg': '#1a1a1a',
        'dark-surface': '#2d2d2d',
        'dark-primary': '#00dc82',
        'dark-secondary': '#36e4da',
      },
      animation: {
        float: 'float 10s ease-in-out infinite',
        glow: 'glow 2s ease-in-out infinite alternate',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-in': 'slide-in 0.3s ease-in-out',
        'slide-out': 'slide-out 0.3s ease-in-out',
      },
      keyframes: {
        float: {
          '0%': { transform: 'translateY(0) rotate(0)', opacity: '0' },
          '20%': { opacity: '1' },
          '80%': { opacity: '1' },
          '100%': { transform: 'translateY(-100vh) rotate(360deg)', opacity: '0' },
        },
        glow: {
          from: { textShadow: '0 0 20px rgba(0, 220, 130, 0.6)' },
          to: { textShadow: '0 0 40px rgba(0, 220, 130, 0.8)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-out': {
          from: { transform: 'translateX(0)', opacity: '1' },
          to: { transform: 'translateX(100%)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};