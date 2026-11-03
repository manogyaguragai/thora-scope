import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import './ui/tokens.css';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

const title = document.createElement('h1');
title.textContent = 'ThoraScope';
title.style.cssText =
  'margin:0;padding:var(--space-4);font-size:var(--font-size-title);font-weight:600;color:var(--color-text)';
app.append(title);
