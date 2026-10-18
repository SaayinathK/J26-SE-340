# Strategy Agent: evaluation report


## Read this first

This report evaluates the Strategy Agent prototype. What the numbers do and do not mean:

- **Simulated A/B** scores strategies on a learned outcome model of a *synthetic* marketing world that we designed. It tests the pipeline (can strategies be compared, does evidence help, is ranking sensible). It does NOT show that the strategies would work for a real business.
- **Quality** is a deterministic heuristic rubric (five yes/no checks per dimension), not human or LLM judgement.
- **Privacy attacks** are simple, clearly-defined attacks (public-attribute linkage and aggregate membership inference). Low success against them is evidence, not a proof of privacy.
- **Generator**: the deterministic template generator was evaluated; the fine-tuned model (base + adapter) was also evaluated on a small subset.


## Run

| metric | value |
|---|---|
| generated_at | 2026-10-23T05:04:34+00:00 |
| seed | 42 |
| briefs | 60 |
| synthetic_tenants | 150 |
| consenting_tenants | 118 |
| k_anonymity | 5 |
| pii_detector | presidio+regex |
| retrieval | tfidf |
| runtime_seconds | 4,362 |


## Key findings

- **Strategies**: the agent's top strategy is clearly better than a random mix (mean uplift difference 0.6721, p = 0) but worse than a simple domain-informed rule baseline in the simulated world (difference -0.064, 95% CI [-0.0827, -0.045], wins 13 / 47).
- **Cross-tenant insights** change the top strategy's predicted uplift by 0.0144 for businesses with no history (95% CI [-0.002, 0.0315], p = 0.1429, wins 36 / 24).
- **PII leakage**: 0 of 150 tenants had any planted identifier in the shared store; 0 structured-PII findings over 4480 stored strings; stored ids are random hex: yes.
- **k-anonymity (k = 5)**: every published insight is backed by at least k distinct tenants: yes; 15 of 24 groups were held back; below-k groups published: 0.
- **Membership inference (worst case)**: AUC 0.7164 at k = 5 without noise and 0.6881 with Laplace noise (0.5 = chance). k-anonymity alone does not stop an attacker who already knows a target's own channel mix. The cost of the noise: the benefit of shared insights goes from 0.0161 to 0.0025.
- **Participation disclosure**: for a business matching a published insight's public attributes, P(it contributed) averages 0.7938 (prior participation rate 0.7867); 2 of 9 insights imply certain participation. k-anonymity guarantees each insight has at least k contributors; it does not hide who they are when every matching business took part.


## 1. Structural

Measured on the generator's raw output, before any repair or fallback.

| generator | JSON parse rate | schema validity | budget shares sum to 1 (raw) | constraint compliance | generator failures |
|---|---|---|---|---|---|
| template | 1 | 1 | 1 | 1 | 0 |
| llm | 1 | 0.3333 | 1 | 1 | 0 |


## 2. Quality rubric (1 to 5)

Deterministic heuristic; see `eval/quality.py`.

| generator | strategies | relevance | specificity | feasibility | coherence | overall |
|---|---|---|---|---|---|---|
| template | 180 | 4.72 | 4.907 | 4.2 | 4.338 | 4.541 |
| llm | 12 | 4.8 | 4.8 | 4.267 | 4.267 | 4.533 |


## 3. Simulated A/B

**Caveat on the rule baseline**: it puts its budget on the few channels our synthetic world rewards most, so it is a strong, domain-informed baseline *in this world*. Losing to it says that diversified mixes underperform concentration here, not anything about real marketing.

60 briefs. Uplift is the relative improvement of the system's top strategy over an even split across the allowed channels, on the objective's primary metric.

| system | mean predicted uplift | 95% CI | mean true uplift (hidden world) | win rate vs even split |
|---|---|---|---|---|
| uniform_reference | 0 | [0, 0] | 0 | 0 |
| random_mix | -0.2912 | [-0.3869, -0.202] | -0.3977 | 0.2 |
| rule_baseline | 0.4449 | [0.3959, 0.4891] | 0.5502 | 1 |
| agent_template_cold_start | 0.3809 | [0.3483, 0.4112] | 0.4892 | 1 |
| agent_template_with_shared | 0.3953 | [0.3522, 0.4374] | 0.5017 | 1 |

**Paired comparisons** (same briefs): mean difference, bootstrap 95% CI, Wilcoxon p-value, wins a / b.

| comparison | mean diff | 95% CI | p | wins a / b |
|---|---|---|---|---|
| agent_template_cold_start vs rule_baseline | -0.064 | [-0.0827, -0.045] | 0 | 13 / 47 |
| agent_template_cold_start vs random_mix | 0.6721 | [0.5825, 0.7636] | 0 | 59 / 1 |
| agent_template_with_shared vs agent_template_cold_start  (ablation: cross-tenant insights) | 0.0144 | [-0.002, 0.0315] | 0.1429 | 36 / 24 |

**Simulator fidelity**: held-out R squared of the learned outcome model per objective {'lead_gen': 0.8797, 'awareness': 0.868, 'retention': 0.862, 'sales': 0.8721}; correlation of predicted vs true uplift across all evaluated strategies: 0.9657.

**Ranking**: rank-1 minus the mean of the other strategies (predicted uplift) = 0.0277; mean Spearman(rank, uplift) = -0.1 (negative Spearman is good: rank 1 should have the highest predicted uplift).


## 4. Privacy

**PII leakage in the shared store** (target: 0). Every tenant's planted identifiers (business, brand, product, competitor, contact person, email, phone, URL, tenant id, exact budget) are searched for.

| metric | value |
|---|---|
| tenants_checked | 150 |
| tenants_with_any_leak | 0 |
| leakage_rate | 0 |
| structured_pii_findings (Presidio+regex over every stored string) | 0 |
| strings_scanned | 4480 |
| opaque_ids_are_random_hex | yes |
| detector | presidio+regex |

**k-anonymity audit**

| metric | value |
|---|---|
| k | 5 |
| insights_published | 9 |
| min_distinct_contributors_in_published | 5 |
| all_published_groups_have_at_least_k | yes |
| groups_total | 24 |
| groups_below_k | 15 |
| below_k_groups_published | 0 |
| contributions_held_back | 87 |

**Attack A: participation disclosure through public-attribute linkage.** P(a tenant matching the insight's public attributes contributed). The attacker is assumed to know the full list of tenants and their public attributes; compare with the prior participation rate.

| metric | value |
|---|---|
| insights_attacked | 9 |
| mean_p_target_contributed | 0.7938 |
| max_p_target_contributed | 1 |
| insights_where_participation_is_certain | 2 |
| prior_participation_rate | 0.7867 |
| min_candidate_set | 6 |
| min_contributors_behind_an_insight | 5 |

**Attack B (aggregate membership inference, worst case: the attacker knows the target's own channel mix).** AUC is estimated from a small number of insights and candidate pairs, so differences of less than about 0.1 should be read as noise.

| metric | value |
|---|---|
| insights_attacked | 7 |
| pairs | 90 |
| auc | 0.7164 |
| chance_auc | 0.5 |

**Privacy versus utility: the effect of k and of Laplace noise (epsilon 1.0 per published aggregate).** AUC closer to 0.5 is more private; utility is the mean predicted-uplift benefit of using shared insights for a business with no history (higher is better).

| k | noise | insights published | A: mean P(contributed) | A: certain participation | B: AUC | B: insights attacked | utility of shared insights |
|---|---|---|---|---|---|---|---|
| 2 | off | 17 | 0.8173 | 6 | 0.7728 | 11 | 0.0143 |
| 2 | on | 16 | 0.8267 | 6 | 0.6985 | 10 | -0.0089 |
| 3 | off | 11 | 0.8086 | 3 | 0.7279 | 8 | 0.0165 |
| 3 | on | 12 | 0.8245 | 4 | 0.5455 | 8 | 0.0022 |
| 5 | off | 9 | 0.7938 | 2 | 0.7164 | 7 | 0.0161 |
| 5 | on | 9 | 0.7938 | 2 | 0.6881 | 7 | 0.0025 |
| 8 | off | 4 | 0.8934 | 2 | 0.5556 | 2 | 0.0044 |
| 8 | on | 4 | 0.8934 | 2 | 0.5393 | 2 | -0.0154 |


## 5. Ablations

**(a) With vs without cross-tenant (shared) insights**, for businesses with no history of their own (cold start). See the paired comparison in section 3.

agent_template_with_shared vs agent_template_cold_start  (ablation: cross-tenant insights): mean difference 0.0144 (95% CI [-0.002, 0.0315], Wilcoxon p = 0.1429, wins 36 / 24).

**(b) Template generator vs local LLM** (same briefs, same ranking and validation):

| system | mean predicted uplift | 95% CI | win rate vs even split | fell back to the template |
|---|---|---|---|---|
| agent_template_cold_start | 0.4493 | [0.34, 0.5484] | 1 | 1 |
| agent_template_with_shared | 0.4368 | [0.2853, 0.5882] | 1 | 1 |
| agent_finetuned_cold_start | 0.4431 | [0.3376, 0.536] | 1 | 0 |
| agent_finetuned_with_shared | 0.5579 | [0.4152, 0.7005] | 1 | 0 |

**Read the last column first.** When a model's output is invalid the service falls back to the template, so a system that falls back often is measuring the template, not the model.

LLM briefs: 4. small sample on CPU: treat differences as indicative only

**(c) Fine-tuned model vs template vs rule baseline: run** (see the table in (b), system `agent_finetuned`).
