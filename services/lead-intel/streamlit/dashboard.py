# services/lead-intel/streamlit/dashboard.py  — C3-12 Lead Intelligence dashboard (Streamlit, older UI; the main UI is frontend/)
# Reads the C3 API only (no direct data access).
#   Local:  uvicorn main:app --app-dir src --port 4003   then   streamlit run streamlit/dashboard.py   (pick a demo tenant)
#   Docker: C3_GATEWAY is set -> sign in through the C4 gateway; the tenant comes from the JWT.
# Theme: dark, teal accent (see .streamlit/config.toml).
import html
import os

import altair as alt
import pandas as pd
import requests
import streamlit as st

API = os.getenv("C3_API", "http://127.0.0.1:4003")   # 127.0.0.1 avoids the Windows localhost delay
GATEWAY = os.getenv("C3_GATEWAY")
ACCENT, CARD, LINE, MUTED = "#00D4C0", "#0F0F0F", "#1F1F1F", "#9A9A9A"
FONT = "Plus Jakarta Sans, Segoe UI, sans-serif"
SEG_COLOURS = {"hot": "#00D4C0", "warm": "#E8C468", "cold": "#5B6B7A"}

st.set_page_config(page_title="C3 Lead Intelligence", page_icon="✱", layout="wide")

# ---------------- theme ----------------
st.markdown(f"""
<style>
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;600;700&display=swap');
html, body, [class*="css"], .stApp, button, input, textarea, select {{ font-family: 'Plus Jakarta Sans', sans-serif; }}
.stApp {{
  background: radial-gradient(900px 520px at 12% 8%, rgba(55,75,12,.35), transparent 60%),
              radial-gradient(800px 500px at 92% 60%, rgba(55,75,12,.25), transparent 60%), #000;
}}
header[data-testid="stHeader"] {{ background: transparent; }}
section[data-testid="stSidebar"] {{ background: #070707; border-right: 1px solid {LINE}; }}
.block-container {{ padding-top: 2.2rem; max-width: 1280px; }}
.eyebrow {{ color: #fff; font-size: .72rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; }}
.eyebrow b {{ color: {ACCENT}; margin-right: .45rem; }}
.hero {{ font-size: 2.6rem; font-weight: 300; line-height: 1.12; color: #fff; margin: .35rem 0 .4rem; }}
.hero span {{ color: {ACCENT}; font-weight: 700; }}
.sub {{ color: {MUTED}; font-size: .95rem; margin-bottom: 1.4rem; }}
.pill {{ display: inline-block; padding: .18rem .7rem; border-radius: 999px; font-size: .75rem; font-weight: 600;
         background: rgba(0,212,192,.12); color: {ACCENT}; border: 1px solid rgba(0,212,192,.35); }}
.card {{ background: {CARD}; border: 1px solid {LINE}; border-radius: 18px; padding: 1.1rem 1.25rem; height: 100%; }}
.kpi-label {{ color: {MUTED}; font-size: .78rem; letter-spacing: .04em; }}
.kpi-value {{ color: {ACCENT}; font-size: 2rem; font-weight: 700; line-height: 1.2; }}
.kpi-note {{ color: #cfcfcf; font-size: .78rem; }}
.section {{ color: #fff; font-size: 1.15rem; font-weight: 600; margin: 1.6rem 0 .6rem; }}
.section b {{ color: {ACCENT}; margin-right: .45rem; }}
table.leads {{ width: 100%; border-collapse: collapse; font-size: .86rem; }}
table.leads th {{ color: {MUTED}; font-weight: 600; text-align: left; padding: .5rem .4rem; border-bottom: 1px solid {LINE}; }}
table.leads td {{ color: #eaeaea; padding: .5rem .4rem; border-bottom: 1px solid #161616; }}
.badge {{ padding: .12rem .55rem; border-radius: 999px; font-size: .72rem; font-weight: 700; color: #000; }}
.score {{ color: {ACCENT}; font-weight: 700; }}
.rec-action {{ color: #fff; font-size: 1.05rem; font-weight: 600; margin: .4rem 0 .6rem; }}
.rec-msg {{ color: #d6d6d6; background: #0a0a0a; border-left: 3px solid {ACCENT}; padding: .7rem .9rem; border-radius: 8px; }}
.chip {{ display: inline-block; margin: .5rem .4rem 0 0; padding: .3rem .7rem; border-radius: 10px; background: #141414;
         border: 1px solid {LINE}; color: #cfcfcf; font-size: .78rem; }}
.chip b {{ color: {ACCENT}; }}
.stButton > button, .stFormSubmitButton > button {{
  background: {ACCENT}; color: #000; border: 0; border-radius: 999px; font-weight: 700; padding: .5rem 1.3rem; }}
.stButton > button:hover, .stFormSubmitButton > button:hover {{ background: #fff; color: #000; }}
.stButton > button:focus:not(:hover), .stFormSubmitButton > button:focus:not(:hover) {{ background: {ACCENT}; color: #000; }}
.foot {{ color: #6f6f6f; font-size: .75rem; margin-top: 2rem; }}
</style>
""", unsafe_allow_html=True)


def e(x) -> str:
    return html.escape("" if x is None else str(x))


def section(title: str):
    st.markdown(f'<div class="section"><b>✱</b>{e(title)}</div>', unsafe_allow_html=True)


def chart_theme(c: alt.Chart) -> alt.Chart:
    return (c.properties(height=260, background="transparent")
             .configure_view(stroke=None)
             .configure_axis(labelColor=MUTED, titleColor=MUTED, gridColor="#1a1a1a", domainColor=LINE,
                             labelFont=FONT, titleFont=FONT, labelFontSize=11, titleFontSize=11)
             .configure_legend(labelColor="#cfcfcf", titleColor=MUTED, labelFont=FONT))


# ---------------- who is looking: gateway login (Docker) or demo tenant (local) ----------------
st.sidebar.markdown('<div class="eyebrow"><b>✱</b>C3 Lead Intelligence</div>', unsafe_allow_html=True)
if GATEWAY:
    API = GATEWAY + "/api"
    if "access_token" not in st.session_state:
        with st.sidebar.form("login"):
            email = st.text_input("Email")
            password = st.text_input("Password", type="password")
            submitted = st.form_submit_button("Sign in")
        if submitted:
            try:
                login = requests.post(GATEWAY + "/api/auth/login",
                                      json={"email": email, "password": password}, timeout=15)
                login.raise_for_status()
                st.session_state["access_token"] = login.json()["access_token"]
                st.session_state["user"] = email
                st.rerun()
            except requests.RequestException:
                st.sidebar.error("Sign in failed")
        st.markdown('<div class="eyebrow"><b>✱</b>Welcome</div>'
                    '<div class="hero">Sign in to see your <span>leads</span></div>'
                    '<div class="sub">Your tenant is taken from your account by the gateway.</div>',
                    unsafe_allow_html=True)
        st.stop()
    st.sidebar.html(f'<span class="pill" style="display:inline-block;padding:.18rem .7rem;border-radius:999px;'
                    f'font-size:.75rem;font-weight:600;background:rgba(0,212,192,.12);color:{ACCENT};'
                    f'border:1px solid rgba(0,212,192,.35)">Signed in</span>'
                    f'<div style="color:#cfcfcf;font-size:.8rem;margin-top:.5rem">{e(st.session_state.get("user"))}</div>')
    if st.sidebar.button("Sign out"):
        st.session_state.clear()
        st.rerun()
    H = {"Authorization": "Bearer " + st.session_state["access_token"]}
    who = "your tenant"
else:
    tenant = st.sidebar.selectbox("Demo tenant", ["tenant_a", "tenant_b", "tenant_c"])
    st.sidebar.caption("Local demo: the tenant is chosen here. Through the gateway it comes from the login token.")
    H = {"X-Tenant-Id": tenant}
    who = tenant

try:
    r1 = requests.get(f"{API}/leads/dashboard", headers=H, timeout=30)
    r2 = requests.get(f"{API}/leads/analytics", headers=H, timeout=30)
    r1.raise_for_status()
    r2.raise_for_status()
    dash, ana = r1.json(), r2.json()
except requests.RequestException as ex:
    if GATEWAY and getattr(ex, "response", None) is not None and ex.response.status_code == 401:
        st.session_state.clear()
        st.warning("Your session expired. Please sign in again.")
        st.stop()
    st.error(f"C3 API not reachable at {API}." + ("" if GATEWAY else " Start it with: uvicorn main:app --app-dir src --port 4003"))
    st.stop()

# ---------------- header ----------------
st.markdown(f'<div class="eyebrow"><b>✱</b>Lead intelligence · {e(who)}</div>'
            '<div class="hero">Turn CRM leads into<br><span>next best actions</span></div>'
            '<div class="sub">Calibrated lead scores, behavioural analytics and grounded recommendations '
            'from this tenant\'s own CRM data.</div>', unsafe_allow_html=True)

# ---------------- KPI cards ----------------
seg = pd.DataFrame(dash["segments"]).set_index("segment")
step = ana["biggest_drop_off"]
kpis = [("Leads", f'{dash["tenant_leads"]:,}', "in this tenant's CRM"),
        ("Conversion rate", f'{ana["conversion_rate"]:.0%}', "historical, all leads"),
        ("Hot leads", f'{int(seg.loc["hot", "leads"]):,}', f'{seg.loc["hot", "conversion_rate"]:.0%} of them converted'),
        ("Biggest drop-off", f'{ana["drop_off_rates"][step]:.0%}',
         step.replace(" (visited site)", "").replace(" -> ", " → "))]
for col, (label, value, note) in zip(st.columns(4), kpis):
    col.markdown(f'<div class="card"><div class="kpi-label">{e(label)}</div><div class="kpi-value">{e(value)}</div>'
                 f'<div class="kpi-note">{e(note)}</div></div>', unsafe_allow_html=True)

# ---------------- leads + segments ----------------
left, right = st.columns([1.25, 1])
with left:
    section("Top 10 hottest leads")
    rows = "".join(
        f'<tr><td>{e(x["lead_id"])}</td><td class="score">{e(x["score"])}</td>'
        f'<td><span class="badge" style="background:{SEG_COLOURS.get(x["segment"], MUTED)}">{e(x["segment"])}</span></td>'
        f'<td>{e(x["source"] or "—")}</td><td>{e(x["last_activity"] or "—")}</td></tr>'
        for x in dash["top_10_hottest"])
    st.markdown(f'<div class="card"><table class="leads"><tr><th>Lead</th><th>Score</th><th>Segment</th>'
                f'<th>Source</th><th>Last activity</th></tr>{rows}</table></div>', unsafe_allow_html=True)
with right:
    section("Leads per segment")
    segdf = seg.reset_index()
    st.altair_chart(chart_theme(alt.Chart(segdf).mark_bar(cornerRadiusTopLeft=8, cornerRadiusTopRight=8).encode(
        x=alt.X("segment:N", sort=["hot", "warm", "cold"], title=None, axis=alt.Axis(labelAngle=0)),
        y=alt.Y("leads:Q", title="leads"),
        color=alt.Color("segment:N", scale=alt.Scale(domain=list(SEG_COLOURS), range=list(SEG_COLOURS.values())),
                        legend=None),
        tooltip=["segment", "leads", alt.Tooltip("conversion_rate:Q", format=".0%")])))

# ---------------- funnel + trend ----------------
left, right = st.columns(2)
with left:
    section("Pipeline funnel")
    funnel = pd.DataFrame({"stage": [s.replace(" (visited site)", "") for s in ana["funnel"]],
                           "leads": list(ana["funnel"].values())})
    funnel["order"] = range(len(funnel))
    st.altair_chart(chart_theme(alt.Chart(funnel).mark_bar(color=ACCENT, cornerRadiusEnd=8).encode(
        y=alt.Y("stage:N", sort=alt.SortField("order"), title=None),
        x=alt.X("leads:Q", title="leads"), tooltip=["stage", "leads"])))
with right:
    section("Weekly conversion trend")
    trend = pd.DataFrame(dash["weekly_trend"])
    st.altair_chart(chart_theme(alt.Chart(trend).mark_line(color=ACCENT, strokeWidth=2.5, point=True).encode(
        x=alt.X("week_start:T", title=None), y=alt.Y("conversion_rate:Q", title="conversion", axis=alt.Axis(format="%")),
        tooltip=["week_start", alt.Tooltip("conversion_rate:Q", format=".0%"), "leads"])))
    if dash["dates_are_synthetic"]:
        st.caption("Dates are synthetic (the source dataset has none): the trend shows the method only.")

# ---------------- recommendation ----------------
section("Grounded recommendation for one lead")
c1, c2 = st.columns([2, 1])
lead_id = c1.selectbox("Lead", [x["lead_id"] for x in dash["top_10_hottest"]], label_visibility="collapsed")
go = c2.button("Get recommendation")
if go:
    with st.spinner("Retrieving this tenant's CRM context and asking the model (1–3 min on CPU)..."):
        try:
            r = requests.get(f"{API}/leads/{lead_id}/recommendation", headers=H, timeout=320)
        except requests.RequestException:
            r = None
    if r is None:
        st.error("The recommendation request timed out or the service is unavailable.")
    elif r.status_code != 200:
        st.error(f"{r.status_code}: {r.text[:300]}")
    else:
        rec = r.json()
        if rec.get("grounded"):
            ok = rec.get("policy_check") == "consistent"
            chips = "".join(f'<span class="chip"><b>{e(s["label"])}</b> · {e(s["type"])}: {e(s["text"][:110])}…</span>'
                            for s in rec.get("sources", []))
            st.markdown(
                f'<div class="card"><span class="pill">{"Policy-consistent" if ok else "Check policy"}</span> '
                f'<span class="pill">score {e(rec.get("score"))} · {e(rec.get("segment"))}</span> '
                f'<span class="pill">model {e(rec.get("llm_model", "-"))}</span>'
                f'<div class="rec-action">{e(rec.get("next_best_action"))}</div>'
                f'<div class="rec-msg">{e(rec.get("message_draft"))}</div>'
                f'<div class="kpi-note" style="margin-top:.8rem">Sources the answer is based on</div>{chips}'
                f'<div class="kpi-note" style="margin-top:.8rem">confidence {e(rec.get("confidence"))} · '
                f'retrieval {e(rec.get("retrieval_method"))} · {"cached" if rec.get("cached") else "fresh"}</div></div>',
                unsafe_allow_html=True)
        else:
            st.warning("Blocked: the model did not cite a real source, so nothing is shown.")

st.markdown(f'<div class="foot">{e(dash["note"])}</div>', unsafe_allow_html=True)
