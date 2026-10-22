import { useEffect, useState } from "react";
import { api } from "../services/api";
export default function CRMLeads({ connection, campaignId }) {
  const [q, setQ] = useState(""),
    [tag, setTag] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [selected, setSelected] = useState(null);
  useEffect(() => {
    setPage(1);
    setSelected(null);
  }, [campaignId, connection?.last_synced_at]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSelected(null);
    const timer = setTimeout(
      () =>
        api
          .crmLeads({
            q,
            tag,
            page,
            ...(campaignId ? { campaign_id: campaignId } : {}),
          })
          .then((value) => {
            if (active) {
              setData(value);
              setError("");
            }
          })
          .catch((e) => {
            if (active) {
              setError(e.message);
              setData(null);
            }
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      250
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, tag, page, campaignId, connection?.last_synced_at]);
  return (
    <section className="panel brief-panel">
      <h2>CRM leads</h2>
      <p>
        {campaignId
          ? "Contacts matching the selected campaign audience."
          : "All synced CRM contacts, shown as leads. A lead is not necessarily a qualified prospect or a purchaser."}{" "}
        Contact details are for your review; content generation uses aggregated
        audience evidence.
      </p>
      <div className="form-stack">
        <label>
          Search leads
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Name, email, phone or company"
            maxLength={200}
          />
        </label>
        <label>
          Tag
          <select
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All tags</option>
            {(connection?.catalog?.tags || []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading leads…</p>
      ) : (
        data && (
          <>
            <p>
              {data.total} leads · Page {page} of{" "}
              {Math.max(1, Math.ceil(data.total / 25))}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", textAlign: "left" }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email / phone</th>
                    <th>Tags</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {data.leads.map((lead) => (
                    <tr key={lead.contact_id}>
                      <td>{lead.details.name || "Unnamed contact"}</td>
                      <td>
                        {lead.details.email || "—"}
                        <br />
                        {lead.details.phone || "—"}
                      </td>
                      <td>{lead.details.tags.join(", ") || "No tags"}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setSelected(lead)}
                        >
                          View details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.leads.length && (
              <p>
                {connection?.last_synced_at
                  ? "No leads match these filters."
                  : "Leads will appear after the first successful sync."}
              </p>
            )}
            <button
              className="btn-secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>{" "}
            <button
              className="btn-secondary"
              disabled={page * 25 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </>
        )
      )}
      {selected && (
        <section className="panel" aria-label="Lead details">
          <h3>{selected.details.name || "Unnamed contact"}</h3>
          <dl>
            {[
              ["email", "Email"],
              ["phone", "Phone"],
              ["company", "Company"],
              ["city", "City"],
              ["state", "State"],
              ["country", "Country"],
              ["source", "Source"],
              ["type", "CRM contact type"],
              ["date_added", "Added in CRM"],
            ].map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{selected.details[key] || "Not provided"}</dd>
              </div>
            ))}
          </dl>
          <p>Tags: {selected.details.tags.join(", ") || "None"}</p>
          <h4>Opportunities</h4>
          {selected.details.opportunities.length ? (
            <ul>
              {selected.details.opportunities.map((o, i) => (
                <li key={i}>
                  {o.name || "Unnamed opportunity"} —{" "}
                  {o.status || "Unknown status"}
                </li>
              ))}
            </ul>
          ) : (
            <p>No linked opportunities.</p>
          )}
          <p>Last synced: {new Date(selected.synced_at).toLocaleString()}</p>
          <button className="btn-secondary" onClick={() => setSelected(null)}>
            Close details
          </button>
        </section>
      )}
    </section>
  );
}
