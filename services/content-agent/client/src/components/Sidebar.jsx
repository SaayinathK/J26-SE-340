import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Sparkles,
  Clock,
  Database,
  Settings,
  LogOut,
  X,
  ArrowUpRight,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
const links = [
  ["/dashboard", "Overview", LayoutDashboard],
  ["/generate", "Generate content", Sparkles],
  ["/history", "History", Clock],
  ["/learning", "Learning", Sparkles],
  ["/crm", "CRM", Database],
  ["/knowledge", "Knowledge base", Database],
  ["/settings", "Business settings", Settings],
];
export default function Sidebar({ open, onClose }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <>
      <button
        className={`sidebar-overlay ${open ? "visible" : ""}`}
        aria-label="Close navigation"
        onClick={onClose}
        tabIndex={open ? 0 : -1}
      />
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="logo">
          <span className="logo-mark">
            <Sparkles size={23} />
          </span>
          AdBloom<span className="logo-ai">AI</span>
          <button
            className="mobile-close"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">CONTENT WORKSPACE</div>
        <nav aria-label="Main navigation">
          {links.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              onClick={onClose}
              className={({ isActive }) =>
                `nav-item ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">
            <Sparkles size={19} />
          </span>
          <h3>
            Better context.
            <br />
            Better content.
          </h3>
          <p>Give your AI the knowledge that makes your business unique.</p>
          <NavLink to="/knowledge" onClick={onClose}>
            Build your knowledge <ArrowUpRight size={16} />
          </NavLink>
        </div>
        <div className="sidebar-user">
          <div className="avatar">{user?.name?.[0]?.toUpperCase() || "C"}</div>
          <div className="user-detail">
            <strong>{user?.name || "Your workspace"}</strong>
            <span title={user?.email}>{user?.email}</span>
          </div>
          <button
            title="Log out"
            aria-label="Log out"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
    </>
  );
}
