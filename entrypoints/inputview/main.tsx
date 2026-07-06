import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './md3.css';

// theme-init.js stamps .light/.dark before first paint, but the keyboard page
// is long-lived — keep the theme live: re-evaluate when the options page
// changes its setting (same-origin localStorage 'mui-mode' → storage event)
// or when the system scheme flips.
function applyTheme() {
    let mode = 'system';
    try {
        mode = localStorage.getItem('mui-mode') ?? 'system';
    } catch { /* storage unavailable — keep system */ }
    const dark = mode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
        : mode === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
}

window.addEventListener('storage', (e) => {
    if (!e.key || e.key === 'mui-mode') applyTheme();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

try {
    document.documentElement.lang = chrome.i18n.getUILanguage();
} catch { /* dev tab — keep the static lang */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
