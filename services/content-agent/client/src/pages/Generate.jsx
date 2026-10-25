import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Megaphone,
  PanelsTopLeft,
  Video,
  MessagesSquare,
  Sparkles,
  ArrowRight,
  RotateCcw,
  WandSparkles,
  Check,
  Loader2,
} from "lucide-react";
import { api } from "../services/api";
import ContentCard from "../components/ContentCard";
import { PageHeading, ErrorMessage, Badge } from "../components/UI";
const types = [
  {
    id: "meta_ad",
    name: "Meta Ad",
    detail: "Personas, hooks & ad copy",
    icon: Megaphone,
    placeholder:
      "Optional: focus on first-time founders and use a friendly tone",
  },
  {
    id: "funnel_page",
    name: "Funnel Page",
    detail: "7 pillars, led by audience pain",
    icon: PanelsTopLeft,
    placeholder: "Optional: emphasize the practical benefits of my main offer",
  },
  {
    id: "vsl",
    name: "VSL Script",
    detail: "Video scripts that connect",
    icon: Video,
    placeholder:
      "Optional: open with a question and keep the script conversational",
  },
  {
    id: "social_post",
    name: "Social Post",
    detail: "Content for your community",
    icon: MessagesSquare,
    placeholder: "Optional: focus on community and keep the posts short",
  },
];
export default function Generate() {
  const [type, setType] = useState("meta_ad");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [resultType, setResultType] = useState("");
  const [preview, setPreview] = useState(null);
  const [progress, setProgress] = useState("");
  const [plan, setPlan] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState("");
  const [mode, setMode] = useState("initial");
  const [campaignLoading, setCampaignLoading] = useState(true);
  const campaign = campaigns.find((c) => c.id === campaignId);
  async function loadCampaigns() {
    const data = await api.getCampaigns();
    setCampaigns(data.campaigns);
    return data.campaigns;
  }
  useEffect(() => {
    let active = true;
    api
      .getCampaigns()
      .then((data) => {
        if (active) {
          setCampaigns(data.campaigns);
          if (data.campaigns.length) {
            const requested = new URLSearchParams(window.location.search).get(
              "campaign_id"
            );
            const chosen =
              data.campaigns.find((c) => c.id === requested) ||
              data.campaigns[0];
            setCampaignId(chosen.id);
            setMode(chosen.winner_index != null ? "winner" : "initial");
          }
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setCampaignLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function chooseWinner(index) {
    setBusy(true);
    setError("");
    try {
      const data = await api.selectWinner(campaignId, index, campaign.version);
      setCampaigns((previous) =>
        previous.map((c) => (c.id === campaignId ? data.campaign : c))
      );
      setMode("winner");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const activeRequest = useRef(null);
  useEffect(() => () => activeRequest.current?.abort(), []);
  function onProgress(event) {
    if (event.type === "status") setProgress(event.message);
    if (event.type === "plan") {
      setPlan(event.personas);
      setProgress(
        event.cached
          ? "Reusing your saved personas. Creating fresh ad copy…"
          : "Personas ready. Creating your ad copy…"
      );
    }
    if (event.type === "persona")
      setPreview((previous) => ({
        schema_version: 2,
        personas: [...(previous?.personas || []), event.persona],
      }));
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    setPreview(null);
    setPlan([]);
    setProgress("Preparing your business context…");
    setResultType(type);
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const data = await api.generate(
        type,
        brief.trim(),
        onProgress,
        controller.signal,
        {
          campaign_id: campaignId,
          generation_mode: type === "meta_ad" ? mode : "initial",
        }
      );
      setResult(data);
      setResultType(type);
      await loadCampaigns();
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message);
        await loadCampaigns().catch(() => {});
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      activeRequest.current = null;
    }
  }
  function reset() {
    setPreview(null);
    setPlan([]);
    setProgress("");
    setResult(null);
    setResultType("");
    setBrief("");
    setError("");
  }
  const displayed = result || preview;
  return (
    <>
      <PageHeading eyebrow="THE CONTENT STUDIO" title="From idea to impact.">
        Choose a format. We’ll create content from your saved business profile,
        audience, and brand voice.
      </PageHeading>
      <div className="generate-grid">
        <div className="generation-main">
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <section className="panel brief-panel">
                <h2>Choose a campaign</h2>
                <label>
                  Campaign
                  <select
                    required
                    value={campaignId}
                    onChange={(e) => {
                      setCampaignId(e.target.value);
                      setMode(
                        campaigns.find((c) => c.id === e.target.value)
                          ?.winner_index != null
                          ? "winner"
                          : "initial"
                      );
                      reset();
                    }}
                  >
                    <option value="">
                      {campaignLoading
                        ? "Loading campaigns…"
                        : "Select a campaign"}
                    </option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <Link to="/settings">
                  Create or edit campaigns in Business settings
                </Link>
                {type === "meta_ad" && campaign && (
                  <>
                    <label>
                      Generation mode
                      <select
                        value={mode}
                        onChange={(e) => {
                          setMode(e.target.value);
                          reset();
                        }}
                      >
                        <option value="initial">
                          Initial / explore — 3 personas
                        </option>
                        <option
                          value="winner"
                          disabled={campaign.winner_index == null}
                        >
                          Winner only — 1 persona
                        </option>
                      </select>
                    </label>
                    <p className="field-help">
                      Meta is not connected. Select a persona below based on
                      your own review or external results. It is not an
                      automatically verified winner.
                    </p>
                    {campaign.personas?.length === 3 && (
                      <div className="form-stack">
                        <h3>Select your winning persona</h3>
                        {campaign.personas.map((persona, index) => (
                          <button
                            key={index}
                            type="button"
                            className="btn-secondary"
                            aria-pressed={campaign.winner_index === index}
                            onClick={() => chooseWinner(index)}
                          >
                            {campaign.winner_index === index ? "✓ " : ""}
                            {persona.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {campaign.draft && (
                      <p className="field-help">
                        Saved progress: {campaign.draft.completed?.length || 0}{" "}
                        personas complete. Generating again with the same
                        settings and instructions resumes the unfinished work.
                      </p>
                    )}
                  </>
                )}
              </section>
              <div className="step-heading">
                <span>01</span>
                <div>
                  <h2>What are we creating?</h2>
                  <p>Choose the right format for your next big idea.</p>
                </div>
              </div>
              <div className="type-grid">
                {types.map(({ id, name, detail, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={type === id}
                    className={`type-card ${type === id ? "selected" : ""}`}
                    onClick={() => {
                      if (id !== type) {
                        setType(id);
                        reset();
                      }
                    }}
                  >
                    <div className="type-card-top">
                      <span className="type-icon">
                        <Icon size={22} />
                      </span>
                      <span className="type-radio">
                        {type === id && <Check size={12} />}
                      </span>
                    </div>
                    <strong>{name}</strong>
                    <small>{detail}</small>
                  </button>
                ))}
              </div>
              <section className="panel brief-panel">
                <div className="step-heading">
                  <span>02</span>
                  <div>
                    <h2>Your business does the briefing</h2>
                    <p>
                      No prompt needed. Your saved profile and knowledge guide
                      the content.
                    </p>
                  </div>
                </div>
                {type === "meta_ad" && (
                  <p className="field-help mb-4">
                    {mode === "winner"
                      ? "Winner set: 1 selected persona"
                      : "Initial campaign: 3 suggested personas"}{" "}
                    and their pain points, 10 hooks per persona, and 3 body-copy
                    options each with primary text, a headline, and CTA.
                  </p>
                )}
                {type === "funnel_page" && (
                  <p className="field-help mb-4">
                    Your funnel follows seven pillars: pain-point hook, problem,
                    solution, benefits, social proof, offer, and call to action.
                  </p>
                )}
                <div className="business-generation-note">
                  <Sparkles size={19} />
                  <p>
                    We’ll use your business, offer, target audience, and brand
                    voice to decide what to write.{" "}
                    <Link to="/settings">Update business profile</Link>
                  </p>
                </div>
                <details className="optional-brief">
                  <summary>Add instructions (optional)</summary>
                  <label htmlFor="brief">
                    Anything specific for this generation?
                  </label>
                  <textarea
                    id="brief"
                    maxLength={10000}
                    rows={4}
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder={types.find((x) => x.id === type).placeholder}
                  />
                  <div className="brief-meta">
                    <span>
                      Leave this blank to let your business profile guide the
                      content.
                    </span>
                    <span>{brief.length.toLocaleString()}/10,000</span>
                  </div>
                </details>
                <ErrorMessage>{error}</ErrorMessage>
                <div className="generate-action">
                  <span>
                    <Sparkles size={15} /> Made for your business
                  </span>
                  <button
                    className="btn-primary"
                    disabled={busy || campaignLoading || !campaignId}
                  >
                    {busy ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <Sparkles size={18} />
                    )}
                    Generate content
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
            </fieldset>
          </form>
          {busy && (
            <div className="panel generation-loading" role="status">
              <div className="generating-orbit">
                <Sparkles size={30} />
              </div>
              <h2>
                {busy && !activeRequest.current
                  ? "Saving your selection…"
                  : type === "meta_ad"
                  ? progress || "Building your persona-based campaign…"
                  : "AI is generating your content…"}
              </h2>
              <p>
                {type === "meta_ad"
                  ? "Identifying audience needs, then creating hooks and copy for each persona. A full campaign can take several minutes."
                  : "This may take 15–30 seconds. Larger requests can take longer."}
              </p>
              <div className="loading-bar" />
            </div>
          )}
          {!displayed && plan.length > 0 && (
            <section className="panel campaign-plan">
              <h2>Suggested audience personas</h2>
              <p>
                Inferred from your business and audience. Your ad copy will
                appear below as it is ready.
              </p>
              {plan.map((persona, index) => (
                <div key={index}>
                  <h3>{persona.name}</h3>
                  <ul>
                    {persona.pain_points.map((pain, i) => (
                      <li key={i}>{pain}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
          {displayed && (
            <section className="panel result-panel" aria-live="polite">
              <div className="result-header">
                <div>
                  <span className="eyebrow">
                    {result
                      ? "READY FOR YOUR NEXT CAMPAIGN"
                      : "CAMPAIGN DRAFT · PROGRESS SAVED"}
                  </span>
                  <h2>
                    {!result
                      ? `${displayed.personas.length} of ${
                          plan.length || (mode === "winner" ? 1 : 3)
                        } personas ready`
                      : resultType === "meta_ad"
                      ? "Your campaign set is here."
                      : "Your content is here."}
                  </h2>
                </div>
                <Badge type={resultType} />
              </div>
              <ContentCard
                key={result?.content_id || "preview"}
                type={resultType}
                output={displayed}
                id={result?.content_id}
                showFeedback={!!result}
              />
              <button
                className="btn-secondary another"
                disabled={busy}
                onClick={reset}
              >
                <RotateCcw size={16} />
                Generate another
              </button>
            </section>
          )}
        </div>
        <aside className="studio-aside">
          <div className="tips-card">
            <div className="tips-icon">
              <WandSparkles size={23} />
            </div>
            <h3>A little context goes a long way.</h3>
            <p>
              Your AI brings together your business profile, brand voice, and
              knowledge base to create content with purpose.
            </p>
            <div className="tip">
              <span>01</span>
              <div>
                <strong>Set up once</strong>
                <p>
                  Save your business, offer, audience, and voice in your
                  profile.
                </p>
              </div>
            </div>
            <div className="tip">
              <span>02</span>
              <div>
                <strong>Choose a format</strong>
                <p>
                  Generate immediately, or add optional instructions for a
                  specific angle.
                </p>
              </div>
            </div>
            <div className="tip">
              <span>03</span>
              <div>
                <strong>Keep learning</strong>
                <p>Rate your content to give your AI useful feedback.</p>
              </div>
            </div>
            <Link to="/knowledge">
              Manage your knowledge <ArrowRight size={15} />
            </Link>
          </div>
          <div className="small-note">
            <span className="note-dot" />
            <p>
              <strong>Your voice, at the center.</strong>
              <br />
              Keep your <Link to="/settings">business profile</Link> up to date
              for more relevant results.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
