import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Menu, ChevronRight, CircleHelp } from "lucide-react";
import Sidebar from "./Sidebar";
const titles = {
  dashboard: "Overview",
  generate: "Generate content",
  history: "History",
  knowledge: "Knowledge base",
  settings: "Business settings",
  learning: "Learning",
  crm: "CRM",
};
export default function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);
  useEffect(() => {
    const close = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar open={open} onClose={() => setOpen(false)} />
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-toggle"
            aria-label="Open navigation"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu size={23} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{titles[pathname.slice(1)] || "Overview"}</strong>
          </div>
          <span className="workspace-chip">
            <span /> C1 Content Agent
          </span>
          <span
            className="help-icon"
            title="Manage your business profile and knowledge base to personalize your content."
          >
            <CircleHelp size={19} />
          </span>
        </header>
        <main id="main">
          <Outlet />
        </main>
        <footer>
          AdBloom AI <span>Built around your business.</span>
        </footer>
      </div>
    </div>
  );
}
