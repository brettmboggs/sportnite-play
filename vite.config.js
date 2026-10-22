import { defineConfig } from 'vite';

// base './' makes the built game (npm run build → dist/) work from any folder or web address,
// e.g. GitHub Pages at /sportnite/ or Netlify Drop
export default defineConfig({
  base: './',
});
