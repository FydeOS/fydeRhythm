import React from 'react';
import ReactDOM from 'react-dom/client';

import { $$ } from '@/lib/utils';

import App from './App';

document.documentElement.lang = chrome.i18n.getUILanguage();
document.title = $$('setting_page');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
