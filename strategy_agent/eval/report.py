"""Render the evaluation results as Markdown and a self-contained HTML page (one section model, two renderers)."""
from __future__ import annotations

import html
from typing import Any

Block = tuple  # ("p", text) | ("table", headers, rows) | ("bullets", [text]) | ("code", text)


def _fmt(v: Any) -> str:
    if v is None:
        return "n/a"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, float):
        return f"{v:.4f}".rstrip("0").rstrip(".") if abs(v) < 1000 else f"{v:,.0f}"
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(_fmt(x) for x in v) + "]"
    return str(v)


def _kv(d: dict) -> Block:
    return ("table", ["metric", "value"], [[k, _fmt(v)] for k, v in d.items() if not isinstance(v, dict)])


def findings(R: dict) -> list[str]:
    sim, p = R["simulator"], R["privacy"]
    f = []
    pc = sim["paired_comparisons"]
    cold_vs_rule = next(v for k, v in pc.items() if k.endswith("cold_start vs rule_baseline"))
    cold_vs_rand = next(v for k, v in pc.items() if k.endswith("cold_start vs random_mix"))
    abl = next(v for k, v in pc.items() if "ablation" in k)
    verdict = "better than" if cold_vs_rule["mean_diff"] > 0 else "worse than"
    f.append(f"**Strategies**: the agent's top strategy is clearly better than a random mix (mean uplift difference {_fmt(cold_vs_rand['mean_diff'])}, p = {_fmt(cold_vs_rand['wilcoxon_p'])}) "
             f"but {verdict} a simple domain-informed rule baseline in the simulated world (difference {_fmt(cold_vs_rule['mean_diff'])}, 95% CI {_fmt(cold_vs_rule['ci95'])}, wins {cold_vs_rule['a_wins']} / {cold_vs_rule['b_wins']}).")
    f.append(f"**Cross-tenant insights** change the top strategy's predicted uplift by {_fmt(abl['mean_diff'])} for businesses with no history (95% CI {_fmt(abl['ci95'])}, p = {_fmt(abl['wilcoxon_p'])}, wins {abl['a_wins']} / {abl['b_wins']}).")
    pii = p["pii"]
    f.append(f"**PII leakage**: {pii['tenants_with_any_leak']} of {pii['tenants_checked']} tenants had any planted identifier in the shared store; {pii['structured_pii_findings']} structured-PII findings over {pii['strings_scanned']} stored strings; stored ids are random hex: {_fmt(pii['opaque_ids_are_random_hex'])}.")
    ka = p["k_audit"]
    f.append(f"**k-anonymity (k = {ka['k']})**: every published insight is backed by at least k distinct tenants: {_fmt(ka['all_published_groups_have_at_least_k'])}; {ka['groups_below_k']} of {ka['groups_total']} groups were held back; below-k groups published: {ka['below_k_groups_published']}.")
    sw = {(r["k"], r["noise"]): r for r in p["sweep"]}
    base, noisy = sw.get((ka["k"], False)), sw.get((ka["k"], True))
    if base and noisy and base["mia"]["auc"] is not None and noisy["mia"]["auc"] is not None:
        f.append(f"**Membership inference (worst case)**: AUC {_fmt(base['mia']['auc'])} at k = {ka['k']} without noise and {_fmt(noisy['mia']['auc'])} with Laplace noise (0.5 = chance). "
                 f"k-anonymity alone does not stop an attacker who already knows a target's own channel mix. The cost of the noise: the benefit of shared insights goes from {_fmt(base['utility'])} to {_fmt(noisy['utility'])}.")
    re_ = p["reidentification"]
    f.append(f"**Participation disclosure**: for a business matching a published insight's public attributes, P(it contributed) averages {_fmt(re_['mean_p_target_contributed'])} "
             f"(prior participation rate {_fmt(re_['prior_participation_rate'])}); {re_['insights_where_participation_is_certain']} of {re_['insights_attacked']} insights imply certain participation. "
             "k-anonymity guarantees each insight has at least k contributors; it does not hide who they are when every matching business took part.")
    return f


def sections(R: dict) -> list[tuple[str, list[Block]]]:
    m = R["meta"]
    out: list[tuple[str, list[Block]]] = []
    out.append(("Read this first", [
        ("p", "This report evaluates the Strategy Agent prototype. What the numbers do and do not mean:"),
        ("bullets", [
            "**Simulated A/B** scores strategies on a learned outcome model of a *synthetic* marketing world that we designed. It tests the pipeline (can strategies be compared, does evidence help, is ranking sensible). It does NOT show that the strategies would work for a real business.",
            "**Quality** is a deterministic heuristic rubric (five yes/no checks per dimension), not human or LLM judgement.",
            "**Privacy attacks** are simple, clearly-defined attacks (public-attribute linkage and aggregate membership inference). Low success against them is evidence, not a proof of privacy.",
            f"**Generator**: {m['generator_note']}",
        ]),
    ]))
    out.append(("Run", [_kv({"generated_at": m["generated_at"], "seed": m["seed"], "briefs": m["n_briefs"], "synthetic_tenants": m["n_tenants"],
                             "consenting_tenants": m["n_consenting"], "k_anonymity": m["k"], "pii_detector": m["pii_detector"], "retrieval": m["retrieval"],
                             "runtime_seconds": m["runtime_seconds"]})]))

    out.append(("Key findings", [("bullets", findings(R))]))

    s = R["structural"]
    out.append(("1. Structural", [("p", "Measured on the generator's raw output, before any repair or fallback."),
                                  ("table", ["generator", "JSON parse rate", "schema validity", "budget shares sum to 1 (raw)", "constraint compliance", "generator failures"],
                                   [[x["generator"], _fmt(x["json_parse_rate"]), _fmt(x["schema_validity_rate"]), _fmt(x["raw_budget_sum_ok_rate"]),
                                     _fmt(x["constraint_compliance_rate"]), _fmt(x["generator_failures"])] for x in s])]))

    q = R["quality"]
    qrows = [[name, str(v["n_strategies"]), *[_fmt(v[d]["mean"]) for d in ("relevance", "specificity", "feasibility", "coherence", "overall")]] for name, v in q.items()]
    out.append(("2. Quality rubric (1 to 5)", [("p", "Deterministic heuristic; see `eval/quality.py`."),
                                              ("table", ["generator", "strategies", "relevance", "specificity", "feasibility", "coherence", "overall"], qrows)]))

    sim = R["simulator"]
    rows = [[k, _fmt(v["mean_predicted_uplift"]), _fmt(v["ci95"]), _fmt(v["mean_true_uplift"]), _fmt(v["win_rate_vs_uniform"])] for k, v in sim["systems"].items()]
    comp = [[k, _fmt(v["mean_diff"]), _fmt(v["ci95"]), _fmt(v["wilcoxon_p"]), f"{v['a_wins']} / {v['b_wins']}"] for k, v in sim["paired_comparisons"].items()]
    fid = sim["simulator_fidelity"]
    out.append(("3. Simulated A/B", [
        ("p", "**Caveat on the rule baseline**: it puts its budget on the few channels our synthetic world rewards most, so it is a strong, domain-informed baseline *in this world*. Losing to it says that diversified mixes underperform concentration here, not anything about real marketing."),
        ("p", f"{sim['n_briefs']} briefs. Uplift is the relative improvement of the system's top strategy over an even split across the allowed channels, on the objective's primary metric."),
        ("table", ["system", "mean predicted uplift", "95% CI", "mean true uplift (hidden world)", "win rate vs even split"], rows),
        ("p", "**Paired comparisons** (same briefs): mean difference, bootstrap 95% CI, Wilcoxon p-value, wins a / b."),
        ("table", ["comparison", "mean diff", "95% CI", "p", "wins a / b"], comp),
        ("p", f"**Simulator fidelity**: held-out R squared of the learned outcome model per objective {_fmt(fid['held_out_r2_log_metric'])}; correlation of predicted vs true uplift across all evaluated strategies: {_fmt(fid['pearson_predicted_vs_true_uplift'])}."),
        ("p", f"**Ranking**: rank-1 minus the mean of the other strategies (predicted uplift) = {_fmt(sim['ranking']['mean_rank1_minus_other_strategies_uplift'])}; mean Spearman(rank, uplift) = {_fmt(sim['ranking']['mean_spearman_rank_vs_uplift'])} ({sim['ranking']['note']})."),
    ]))

    p = R["privacy"]
    pii, ka, re_, mia = p["pii"], p["k_audit"], p["reidentification"], p["membership_inference"]
    out.append(("4. Privacy", [
        ("p", "**PII leakage in the shared store** (target: 0). Every tenant's planted identifiers (business, brand, product, competitor, contact person, email, phone, URL, tenant id, exact budget) are searched for."),
        _kv({"tenants_checked": pii["tenants_checked"], "tenants_with_any_leak": pii["tenants_with_any_leak"], "leakage_rate": pii["leakage_rate"],
             "structured_pii_findings (Presidio+regex over every stored string)": pii["structured_pii_findings"], "strings_scanned": pii["strings_scanned"], "opaque_ids_are_random_hex": pii["opaque_ids_are_random_hex"], "detector": pii["detector"]}),
        ("p", "**k-anonymity audit**"),
        _kv({k: v for k, v in ka.items()}),
        ("p", f"**Attack A: participation disclosure through public-attribute linkage.** {re_['note']}."),
        _kv({k: v for k, v in re_.items() if k != "note"}),
        ("p", "**Attack B (aggregate membership inference, worst case: the attacker knows the target's own channel mix).** AUC is estimated from a small number of insights and candidate pairs, so differences of less than about 0.1 should be read as noise."),
        _kv({k: v for k, v in mia.items()}),
        ("p", "**Privacy versus utility: the effect of k and of Laplace noise (epsilon 1.0 per published aggregate).** AUC closer to 0.5 is more private; utility is the mean predicted-uplift benefit of using shared insights for a business with no history (higher is better)."),
        ("table", ["k", "noise", "insights published", "A: mean P(contributed)", "A: certain participation", "B: AUC", "B: insights attacked", "utility of shared insights"],
         [[str(r["k"]), "on" if r["noise"] else "off", str(r["audit"]["insights_published"]), _fmt(r["reid"]["mean_p_target_contributed"]), str(r["reid"]["insights_where_participation_is_certain"]),
           _fmt(r["mia"]["auc"]), str(r["mia"]["insights_attacked"]), _fmt(r["utility"])] for r in p["sweep"]]),
    ]))

    ab = R["ablations"]
    blocks: list[Block] = [("p", "**(a) With vs without cross-tenant (shared) insights**, for businesses with no history of their own (cold start). See the paired comparison in section 3.")]
    sh = sim["paired_comparisons"]
    for key, v in sh.items():
        if "ablation" in key:
            blocks.append(("p", f"{key}: mean difference {_fmt(v['mean_diff'])} (95% CI {_fmt(v['ci95'])}, Wilcoxon p = {_fmt(v['wilcoxon_p'])}, wins {v['a_wins']} / {v['b_wins']})."))
    llm = ab["template_vs_llm"]
    if llm["status"] == "run":
        blocks.append(("p", "**(b) Template generator vs local LLM** (same briefs, same ranking and validation):"))
        blocks.append(("table", ["system", "mean predicted uplift", "95% CI", "win rate vs even split", "fell back to the template"],
                       [[k, _fmt(v["mean_predicted_uplift"]), _fmt(v["ci95"]), _fmt(v["win_rate_vs_uniform"]), _fmt(v.get("fell_back_to_template_rate"))] for k, v in llm["systems"].items()]))
        blocks.append(("p", "**Read the last column first.** When a model's output is invalid the service falls back to the template, so a system that falls back often is measuring the template, not the model."))
        blocks.append(("p", f"LLM briefs: {llm['n_briefs']}. {llm.get('note', '')}"))
    else:
        blocks.append(("p", f"**(b) Template generator vs local LLM: NOT RUN.** {llm['reason']}"))
    ft = ab["finetuned"]
    blocks.append(("p", f"**(c) Fine-tuned model vs template vs rule baseline: " + ("run** (see the table in (b), system `agent_finetuned`)." if ft["status"] == "run" else f"NOT RUN.** {ft['reason']}")))
    out.append(("5. Ablations", blocks))
    return out


def render_markdown(R: dict) -> str:
    lines = [f"# Strategy Agent: evaluation report\n"]
    for title, blocks in sections(R):
        lines.append(f"\n## {title}\n")
        for b in blocks:
            if b[0] == "p":
                lines.append(b[1] + "\n")
            elif b[0] == "bullets":
                lines.extend(f"- {x}" for x in b[1]); lines.append("")
            elif b[0] == "table":
                lines.append("| " + " | ".join(b[1]) + " |")
                lines.append("|" + "---|" * len(b[1]))
                lines.extend("| " + " | ".join(r) + " |" for r in b[2])
                lines.append("")
    return "\n".join(lines)


def _inline(text: str) -> str:
    import re
    t = html.escape(text)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    return re.sub(r"`(.+?)`", r"<code>\1</code>", t)


def render_html(R: dict) -> str:
    body = ["<h1>Strategy Agent: evaluation report</h1>"]
    for title, blocks in sections(R):
        body.append(f"<h2>{html.escape(title)}</h2>")
        for b in blocks:
            if b[0] == "p":
                body.append(f"<p>{_inline(b[1])}</p>")
            elif b[0] == "bullets":
                body.append("<ul>" + "".join(f"<li>{_inline(x)}</li>" for x in b[1]) + "</ul>")
            elif b[0] == "table":
                head = "".join(f"<th>{html.escape(h)}</th>" for h in b[1])
                rows = "".join("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in r) + "</tr>" for r in b[2])
                body.append(f"<table><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>")
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>Strategy Agent evaluation report</title><style>"
            ":root{--ink:#1b2430;--mut:#566070;--line:#d5dce6;--head:#1f3a5f;--bg:#fff;--zebra:#f4f7fb;--code:#edf1f6}"
            "@media(prefers-color-scheme:dark){:root{--ink:#e6ebf2;--mut:#9aa6b6;--line:#2c3644;--head:#2f5a94;--bg:#11161d;--zebra:#171e28;--code:#222c39}}"
            "body{font:15px/1.55 system-ui,Segoe UI,Arial,sans-serif;color:var(--ink);background:var(--bg);max-width:1000px;margin:0 auto;padding:24px 16px}"
            "h1{font-size:26px;color:var(--head)}h2{font-size:19px;margin-top:32px;border-bottom:2px solid var(--head);padding-bottom:4px}"
            "table{border-collapse:collapse;width:100%;margin:10px 0 18px;font-size:13.5px;display:block;overflow-x:auto}"
            "th{background:var(--head);color:#fff;text-align:left;padding:6px 9px}td{padding:6px 9px;border:1px solid var(--line)}"
            "tbody tr:nth-child(even) td{background:var(--zebra)}code{background:var(--code);padding:1px 4px;border-radius:3px;font-size:13px}"
            "</style></head><body>" + "\n".join(body) + "</body></html>")
