import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles,
  ArrowUpRight,
  ArrowRight,
  Database,
  Trophy,
  CreditCard,
  FileText,
  Settings,
  Plus,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import {
  Badge,
  Empty,
  ErrorMessage,
  Loading,
  PageHeading,
  formatDate,
  parseObject,
} from "../components/UI";
export default function Dashboard() {
  const { user } = useAuth();
  const [history, setHistory] = useState([]);
  const [knowledge, setKnowledge] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [learning, setLearning] = useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.allSettled([
      api.history(),
      api.getKnowledge(),
      api.learningSummary(),
    ]).then((results) => {
      if (!active) return;
      if (results[0].status === "fulfilled")
        setHistory(results[0].value.history || []);
      if (results[1].status === "fulfilled")
        setKnowledge(
          results[1].value.entries || results[1].value.knowledge || []
        );
      if (results[2].status === "fulfilled")
        setLearning(results[2].value.summary);
      setError(
        results
          .filter((r) => r.status === "rejected")
          .map((r) => r.reason.message)
          .join(" ")
      );
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [retry]);
  const stats = [
    [
      "Total generations",
      history.length,
      "In your latest 20",
      FileText,
      "indigo",
    ],
    [
      "KB entries",
      knowledge.length,
      "Your business knowledge",
      Database,
      "teal",
    ],
    [
      "Approved prompt versions",
      learning?.approved_prompts ?? "—",
      "Based on user ratings · see Learning",
      Trophy,
      "amber",
    ],
    [
      "Current plan",
      user?.plan || "free",
      "Your workspace plan",
      CreditCard,
      "violet",
    ],
  ];
  return (
    <>
      <PageHeading
        title={`Welcome back${
          user?.name ? `, ${user.name.split(" ")[0]}` : ""
        }.`}
        action={
          <Link className="btn-primary" to="/generate">
            <Plus size={18} />
            Create content
          </Link>
        }
      >
        A fresh perspective on your content. A new opportunity to connect.
      </PageHeading>
      <ErrorMessage>{error}</ErrorMessage>
      {error && (
        <button className="text-button" onClick={() => setRetry((x) => x + 1)}>
          Retry dashboard
        </button>
      )}
      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="stats-grid">
            {stats.map(([label, value, note, Icon, color]) => (
              <div className="stat-card" key={label}>
                <div className="stat-top">
                  <span>{label}</span>
                  <span className={`stat-icon ${color}`}>
                    <Icon size={18} />
                  </span>
                </div>
                <strong className="stat-value">{value}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>
          <section className="welcome-banner">
            <div>
              <span className="eyebrow">YOUR NEXT CAMPAIGN STARTS HERE</span>
              <h2>Good ideas deserve great content.</h2>
              <p>Bring your next idea to life, in your own brand voice.</p>
              <Link className="btn-primary" to="/generate">
                <Sparkles size={17} />
                Generate new content
                <ArrowRight size={17} />
              </Link>
            </div>
            <div className="banner-art" aria-hidden="true">
              <div className="art-orbit orbit-one" />
              <div className="art-orbit orbit-two" />
              <div className="art-sheet">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="art-spark">
                <Sparkles size={32} />
              </div>
            </div>
          </section>
          <div className="dashboard-lower">
            <section className="panel">
              <div className="section-title">
                <div>
                  <h2>Recent creations</h2>
                  <p>Your latest ideas, brought to life.</p>
                </div>
                <Link to="/history">
                  View all
                  <ArrowRight size={15} />
                </Link>
              </div>
              {history.length ? (
                <div className="recent-list">
                  {history.slice(0, 5).map((row) => (
                    <Link to="/history" key={row.id} className="recent-item">
                      <div className="recent-icon">
                        <FileText size={19} />
                      </div>
                      <div>
                        <Badge
                          type={
                            row.agent_type ||
                            parseObject(row.input_params).content_type
                          }
                        />
                        <p>
                          {parseObject(row.input_params).brief ||
                            "Marketing content"}
                        </p>
                      </div>
                      <span>{formatDate(row.created_at)}</span>
                      <ArrowUpRight size={17} />
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty
                  title="Your story starts here"
                  action={
                    <Link className="btn-secondary" to="/generate">
                      Create your first content
                      <ArrowRight size={16} />
                    </Link>
                  }
                >
                  Your latest generations will appear in this space.
                </Empty>
              )}
            </section>
            <section className="panel quick-actions">
              <h2>Build a stronger foundation</h2>
              <p>Give your AI the context it needs.</p>
              <Link to="/knowledge">
                <span className="action-icon">
                  <Database size={20} />
                </span>
                <div>
                  <strong>Knowledge base</strong>
                  <p>Add insights that matter.</p>
                </div>
                <ArrowUpRight size={18} />
              </Link>
              <Link to="/settings">
                <span className="action-icon">
                  <Settings size={20} />
                </span>
                <div>
                  <strong>Business profile</strong>
                  <p>Tell your business story.</p>
                </div>
                <ArrowUpRight size={18} />
              </Link>
              <div className="foundation-note">
                Save your business profile, then choose a format and generate.
                Add knowledge anytime to give your AI more context.
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
