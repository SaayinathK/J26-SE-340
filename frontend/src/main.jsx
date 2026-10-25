// src/main.jsx — entry point
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.jsx';
import { ToastProvider } from './components/ui.jsx';
import './styles/styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
