import forms from '@tailwindcss/forms';

const c = (v) => `rgb(var(--${v}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: c('surface'), 'surface-dim': c('surface-dim'), background: c('surface'),
        'surface-container-lowest': c('lowest'), 'surface-container-low': c('surface-low'),
        'surface-container': c('surface-container'), 'surface-container-high': c('surface-high'),
        outline: c('outline'), 'outline-variant': c('outline-variant'),
        'on-surface': c('on-surface'), 'on-surface-variant': c('on-surface-variant'),
        primary: c('primary'), 'primary-container': c('primary-container'), 'on-primary': c('on-primary'),
        secondary: c('secondary'), tertiary: c('ok'), error: c('error'), warn: c('warn'),
      },
      fontFamily: { sans: ['Geist', 'system-ui', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
    },
  },
  plugins: [forms],
};
