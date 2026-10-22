import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Loading, ErrorMessage } from "./UI";
export default function ProtectedRoute({ children }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading) return <Loading />;
  if (!auth.isAuthenticated)
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (auth.error)
    return (
      <div className="auth-retry">
        <ErrorMessage>{auth.error}</ErrorMessage>
        <button className="btn-primary" onClick={auth.retry}>
          Retry connection
        </button>
        <button className="btn-secondary" onClick={auth.logout}>
          Back to login
        </button>
      </div>
    );
  return children;
}
