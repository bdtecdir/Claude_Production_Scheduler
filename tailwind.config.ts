import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        critical: { DEFAULT: '#dc2626', soft: '#fee2e2', amber: '#f59e0b' },
      },
    },
  },
  plugins: [],
};

export default config;
