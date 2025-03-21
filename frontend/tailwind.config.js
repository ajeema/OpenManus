
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'dark-bg': '#171717',
        'dark-surface': '#1e1e1e',
        'dark-primary': '#0078d4',
        'dark-secondary': '#264f78',
        'editor-bg': '#1e1e1e',
        'editor-surface': '#252526',
        'editor-border': '#323232',
        'editor-text': '#d4d4d4',
        'editor-highlight': '#264f78',
        'editor-accent': '#0078d4',
        'editor-line': '#858585',
        'gray': {
          100: '#f5f5f5',
          200: '#eeeeee',
          300: '#e0e0e0',
          400: '#bdbdbd',
          500: '#9e9e9e',
          600: '#757575',
          700: '#616161',
          800: '#424242',
          900: '#212121',
        }
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-in': 'slide-in 0.3s ease-out',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in': {
          '0%': { transform: 'translateX(-10px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        }
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwind-scrollbar'),
  ],
  layer: {
    utilities: {
      '.scrollbar-thin': {
        scrollbarWidth: 'thin',
        '&::-webkit-scrollbar': {
          width: '8px',
          height: '8px',
        },
      },
      '.scrollbar-thumb-gray-600': {
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: '#4B5563',
          borderRadius: '4px',
        },
      },
      '.scrollbar-track-transparent': {
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'transparent',
        },
      },
    },
  },
};
