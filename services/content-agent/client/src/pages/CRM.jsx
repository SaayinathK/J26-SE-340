import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import CRMLeads from "../components/CRMLeads";
import { api } from "../services/api";
const empty = { tags: [], segment_field: "", pain_field: "", goal_field: "" };
export default function CRM() {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [location, setLocation] = useState(""),
    [token, setToken] = useState(""),
    [campaign, setCampaign] = useState(""),
    [mapping, setMapping] = useState(empty);
  const load = async () => {
    const value = await api.crm();
    setData(value);
    return value;
  };
  useEffect(() => {
    let active = true;
    const refresh = () =>
      api
        .crm()
        .then((value) => {
          if (active) setData(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const act = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const connection = data?.connection;
  const selected = data?.campaigns?.find((c) => c.id === campaign);
  const fields = (connection?.catalog?.fields || []).filter(
    (f) =>
      ["SINGLE_OPTIONS", "MULTIPLE_OPTIONS", "RADIO", "CHECKBOX"].includes(
        f.dataType
      ) && f.options?.length
  );
  const choose = (id) => {
    setCampaign(id);
    setMapping(data.campaigns.find((c) => c.id === id)?.mapping || empty);
  };
  return (
    <div className="page">
      <h1>CRM</h1>
      <p>
        Automatically use customer segments and recorded needs to inform your
        campaign personas and content. Data refreshes every 15 minutes.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <section className="card">
        <h2>{connection ? "CRM connection" : "Connect your CRM"}</h2>
        <p>
          Create a private integration in your CRM account with read access to
          locations, contacts, opportunities and contact custom fields. Paste
          its token here once. Credentials are encrypted on the server.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              await api.connectCRM({
                location_id: location || connection?.location_id,
                token,
              });
              setToken("");
            });
          }}
        >
          <label>
            Account / location ID
            <input
              required
              value={location || connection?.location_id || ""}
              onChange={(e) => setLocation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Private integration token
            <input
              required
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <button disabled={busy} type="submit">
            {connection ? "Update connection" : "Connect CRM"}
          </button>
        </form>
        {connection && (
          <>
            <p>
              Status: <strong>{connection.status}</strong> · Last successful
              sync:{" "}
              {connection.last_synced_at
                ? new Date(connection.last_synced_at).toLocaleString()
                : "Not yet synced"}
            </p>
            <p>
              {connection.business?.business_name} · {connection.contact_count}{" "}
              contacts · {connection.opportunity_count} opportunities
            </p>
            {connection.last_error && (
              <p role="alert">{connection.last_error}</p>
            )}
            <button
              disabled={
                busy || ["syncing", "queued"].includes(connection.status)
              }
              onClick={() => act(api.syncCRM)}
            >
              Sync now
            </button>{" "}
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api.disconnectCRM();
                  setCampaign("");
                  setLocation("");
                })
              }
            >
              Disconnect
            </button>
          </>
        )}
      </section>
      {connection && (
        <section className="card">
          <h2>Campaign audience</h2>
          <p>
            Select a campaign and its customer tags once. Leave tags empty to
            use all contacts in this CRM account. Saving refreshes its evidence
            automatically.
          </p>
          <label>
            Campaign
            <select value={campaign} onChange={(e) => choose(e.target.value)}>
              <option value="">Choose campaign</option>
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <fieldset>
                <legend>Customer tags (match any selected tag)</legend>
                {(connection.catalog.tags || []).map((tag) => (
                  <label key={tag}>
                    <input
                      type="checkbox"
                      checked={mapping.tags.includes(tag)}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          tags: e.target.checked
                            ? [...mapping.tags, tag]
                            : mapping.tags.filter((t) => t !== tag),
                        })
                      }
                    />
                    {tag}
                  </label>
                ))}
              </fieldset>
              {Object.entries({
                segment_field: "Audience category",
                pain_field: "Recorded pain point",
                goal_field: "Recorded goal",
              }).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <select
                    value={mapping[key]}
                    onChange={(e) =>
                      setMapping({ ...mapping, [key]: e.target.value })
                    }
                  >
                    <option value="">
                      {key === "segment_field"
                        ? "Use customer tags"
                        : "Not recorded"}
                    </option>
                    {fields.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <p>
                Only existing categorical fields are used. Contact details are
                stored for your leads view. Names, emails and phone numbers are
                excluded from model prompts; free-text contact notes are not
                imported.
              </p>
              <button
                disabled={busy}
                onClick={() => act(() => api.mapCRM(campaign, mapping))}
              >
                Save audience and sync
              </button>
              {selected.summary && (
                <>
                  <h3>Lead analysis for content</h3>
                  <p>
                    {selected.summary.contact_count} matching contacts · Updated{" "}
                    {new Date(selected.synced_at).toLocaleString()}
                    {Date.now() - new Date(selected.synced_at).getTime() >
                    86400000
                      ? " · Expired: excluded from generation until sync succeeds"
                      : ""}
                  </p>
                  {[
                    ["segments", "Segments"],
                    ["recorded_pain_points", "Recorded pain points"],
                    ["recorded_goals", "Recorded goals"],
                  ].map(([key, label]) => (
                    <div key={key}>
                      <h4>{label}</h4>
                      {selected.summary[key]?.length ? (
                        <ul>
                          {selected.summary[key].map((item) => (
                            <li key={item.value}>
                              {item.value}: {item.count} contacts
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p>No categories with at least three contacts.</p>
                      )}
                    </div>
                  ))}
                  <p>{selected.summary.limitations}</p>
                  {selected.summary.contact_count > 0 &&
                    Date.now() - new Date(selected.synced_at).getTime() <
                      86400000 && (
                      <Link
                        className="btn-primary"
                        to={`/generate?campaign_id=${encodeURIComponent(
                          campaign
                        )}`}
                      >
                        Prepare content for this audience
                      </Link>
                    )}
                </>
              )}
            </>
          )}
        </section>
      )}
      {connection && <CRMLeads connection={connection} campaignId={campaign} />}
    </div>
  );
}
