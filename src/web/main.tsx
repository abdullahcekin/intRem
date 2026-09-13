import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { InfoPage } from './InfoPage';
import './styles.css';

const publicGuide = /^\/info\/?$/.test(window.location.pathname);
createRoot(document.getElementById('root')!).render(<React.StrictMode>{publicGuide ? <InfoPage /> : <App />}</React.StrictMode>);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // The online application works even if PWA installation is unavailable.
    });
  });
}
