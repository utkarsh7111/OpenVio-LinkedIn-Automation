import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        linkedin: {
          DEFAULT: '#0a66c2',
          dark: '#004182',
          light: '#e8f3fc',
        },
      },
    },
  },
  plugins: [],
};

export default config;
