import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Generate from './pages/Generate';
import History from './pages/History';
import Knowledge from './pages/Knowledge';
import Settings from './pages/Settings';
export default function App() {
  return <Routes><Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} /><Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}><Route index element={<Navigate to="/dashboard" replace />} /><Route path="dashboard" element={<Dashboard />} /><Route path="generate" element={<Generate />} /><Route path="history" element={<History />} /><Route path="knowledge" element={<Knowledge />} /><Route path="settings" element={<Settings />} /></Route><Route path="*" element={<Navigate to="/dashboard" replace />} /></Routes>;
}
