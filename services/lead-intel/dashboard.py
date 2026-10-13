# services/lead-intel/dashboard.py  — C3-12 Lead analytics dashboard (Streamlit)
# Reads the C3 API only (no direct data access).  Run the API first, then:
#   streamlit run dashboard.py
# Demo note: it sends X-Tenant-Id itself. In the full system the C4 gateway sets it from the JWT.
import os
import pandas as pd
import requests
import streamlit as st

API = os.getenv("C3_API", "http://127.0.0.1:3001")   # 127.0.0.1 avoids the Windows localhost delay
st.set_page_config(page_title="C3 Lead Intelligence", layout="wide")
st.title("Lead Intelligence dashboard")
tenant = st.sidebar.selectbox("Tenant", ["tenant_a", "tenant_b", "tenant_c"])
H = {"X-Tenant-Id": tenant}

try:
    dash = requests.get(f"{API}/leads/dashboard", headers=H, timeout=30).json()
    ana = requests.get(f"{API}/leads/analytics", headers=H, timeout=30).json()
except requests.RequestException:
    st.error(f"C3 API not reachable at {API}. Start it with: uvicorn app:app --port 3001")
    st.stop()

seg = pd.DataFrame(dash["segments"]).set_index("segment")
c1, c2, c3, c4 = st.columns(4)
c1.metric("Leads", dash["tenant_leads"])
c2.metric("Conversion rate", f"{ana['conversion_rate']:.0%}")
c3.metric("Hot leads", int(seg.loc["hot", "leads"]))
step = ana["biggest_drop_off"]
c4.metric("Biggest drop-off", f"{ana['drop_off_rates'][step]:.0%} lost")
c4.caption(step.replace(" (visited site)", "").replace(" -> ", " → "))

left, right = st.columns(2)
with left:
    st.subheader("Top 10 hottest leads")
    st.dataframe(pd.DataFrame(dash["top_10_hottest"]), hide_index=True, use_container_width=True)
    st.subheader("Leads per segment")
    st.bar_chart(seg["leads"].rename(lambda s: {"hot": "1 hot", "warm": "2 warm", "cold": "3 cold"}[s]))
with right:
    st.subheader("Weekly trend")
    trend = pd.DataFrame(dash["weekly_trend"]).set_index("week_start")
    st.line_chart(trend[["conversion_rate"]])
    if dash["dates_are_synthetic"]:
        st.caption("Dates are synthetic (the source dataset has no dates): the trend shows the method only.")
    st.subheader("Funnel")
    funnel = pd.Series(ana["funnel"])
    funnel.index = [f"{i} {n.replace(' (visited site)', '')}" for i, n in enumerate(funnel.index, 1)]
    st.bar_chart(funnel)                        # numbered so the stages stay in pipeline order

st.subheader("Recommendation for one lead")
lead_id = st.selectbox("Lead", [x["lead_id"] for x in dash["top_10_hottest"]])
if st.button("Get grounded recommendation (30-120 s on CPU)"):
    with st.spinner("Retrieving tenant context and asking Mistral..."):
        r = requests.get(f"{API}/leads/{lead_id}/recommendation", headers=H, timeout=300)
    if r.status_code != 200:
        st.error(f"{r.status_code}: {r.text}")
    else:
        rec = r.json()
        if rec["grounded"]:
            st.success(rec["next_best_action"])
            st.write(rec["message_draft"])
            st.caption(f"Policy check: {rec['policy_check']} · confidence {rec['confidence']}")
            for s in rec["sources"]:
                st.markdown(f"- **{s['label']}** ({s['type']}): {s['text'][:160]}")
        else:
            st.warning("Blocked: the model did not cite a real source, so nothing is shown.")
st.caption(dash["note"])