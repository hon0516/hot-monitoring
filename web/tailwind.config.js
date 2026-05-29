/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    extend: {
      colors: {
        ink: '#07111f',
        cyan: '#37d8ff',
        acid: '#88ff6b',
        ember: '#ff8d4d',
        violet: '#6e83ff',
        grid: 'rgba(120, 161, 255, 0.12)'
      },
      fontFamily: {
        display: ['Space Grotesk', 'Avenir Next', 'PingFang SC', 'sans-serif'],
        body: ['IBM Plex Sans', 'PingFang SC', 'sans-serif'],
        mono: ['IBM Plex Mono', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        neon: '0 0 0 1px rgba(55,216,255,0.25), 0 0 28px rgba(55,216,255,0.12)'
      },
      keyframes: {
        pulseLine: {
          '0%, 100%': { opacity: '0.35', transform: 'translateX(0)' },
          '50%': { opacity: '1', transform: 'translateX(10px)' }
        },
        rise: {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' }
        }
      },
      animation: {
        pulseLine: 'pulseLine 3s ease-in-out infinite',
        rise: 'rise 0.7s ease-out both',
        float: 'float 6s ease-in-out infinite'
      }
    }
  },
  plugins: []
};

