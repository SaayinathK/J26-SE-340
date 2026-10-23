import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AuthProvider } from './hooks/useAuth.jsx';
import './styles/styles.css';
import './styles/brand.css';
import './styles/auth.css';
import './styles/services.css';
import './styles/navigation.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>);
