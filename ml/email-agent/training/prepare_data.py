"""
C4 fine-tuning data builder: Kaggle "Email Marketing Campaign CTR" CSV
-> Mistral chat JSONL (train.jsonl / val.jsonl) of grounded 3-step email sequences.

Put this file in ml/email-agent/training/ and run:
    python prepare_data.py --csv Email_Marketing_Campaign_CTR_Dataset.csv --out data --n 900

What it does (each step is printed in the report at the end):
  1. Cleans every email body (literal "/n", duplicated / misplaced signatures,
     placeholder spellings, URLs, bracket CTAs).
  2. Drops emails that are too short, too long or near-duplicates.
  3. Builds 3-step sequences per product: step 1 = intro / value (no urgency),
     step 2 = benefit or offer, step 3 = urgency / last chance.
  4. Writes a brand context for each sequence and REWRITES every number in the
     emails so the target answer only uses facts from that context
     (the raw dataset mixes 10%, 15% and 20% in the same email).
     About 25% of sequences have NO offer in the context; for those, every
     sentence with a %, a price or a promo code is removed, so the model learns
     not to invent offers.
  5. Uses the SAME prompt text as services/email-agent/src/agent/prompts/emailPrompt.js.
     If you change the prompt there, change build_prompt() here too.
  6. Runs the same guardrails as guardrails.js plus the grounding check, and drops
     every example that fails.
  7. Splits by product (whole products held out for validation), so validation
     measures generalisation and not memorisation.
"""
import argparse
import json
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd

UNSUB = "To unsubscribe from these emails, reply STOP or click here."
SEND_DAYS = [0, 3, 7]

# Fictional brands only (never your real PP1 tenants, so your evaluation stays clean).
BRANDS = [
    ("Bloom & Basil Kitchen", "warm, friendly and food-loving"),
    ("Northpeak Outdoor Co.", "adventurous, energetic and practical"),
    ("Lumen Home Studio", "calm, elegant and design-focused"),
    ("Kite Learning Hub", "encouraging, clear and supportive"),
    ("Harbor Lane Boutique", "stylish, confident and playful"),
    ("Pulse Fitness Lab", "motivating, science-backed and upbeat"),
    ("Cedar & Co. Furniture", "trustworthy, warm and craft-focused"),
    ("Orbit Tech Store", "smart, concise and modern"),
    ("Sunday Paper Press", "thoughtful, curious and informative"),
    ("Wanderwise Travel", "inspiring, relaxed and helpful"),
    ("Petal Post Gifts", "cheerful, caring and personal"),
    ("Brightside Bank", "reassuring, plain-spoken and professional"),
    ("Mosaic Art Collective", "creative, vibrant and welcoming"),
    ("Greenway Grocers", "fresh, honest and community-minded"),
    ("Atlas Coworking", "focused, professional and friendly"),
    ("Velvet Spoon Bakery", "sweet, cosy and joyful"),
]
CODE_WORDS = ["WELCOME", "HELLO", "THANKS", "TREAT", "BRIGHT", "FRESH", "JOIN", "GLOW", "SPARK", "HAPPY"]
SPAM_WORDS = ["free!!!", "guaranteed income", "act now!!!", "limited time offer", "click here now", "make money fast"]
PII_RE = re.compile(r"\b(\+?\d[\d\s\-]{7,}\d|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{9,12})\b")
NUM_FACT_RE = re.compile(r"\d+(?:\.\d+)?%|\$\s?\d[\d,]*(?:\.\d+)?|\b\d+x\b")
CODE_RE = re.compile(r"\b(?:[Ss]ave|SAVE|CODE|PROMO|DEAL|OFF)\d+\b|\b[A-Z]{3,}\d{1,3}\b")
SIG_RE = re.compile(r"(?im)^\s*(warm regards|best regards|kind regards|regards|sincerely|cheers|best)\s*,?.*$")


PRODUCT_BRANDS = {   # keyword in product -> brands that make sense for it
    "restaurant|food|recipe|halloween recipes": ["Bloom & Basil Kitchen", "Velvet Spoon Bakery", "Greenway Grocers"],
    "furniture": ["Cedar & Co. Furniture", "Lumen Home Studio"],
    "boutique|fashion": ["Harbor Lane Boutique"],
    "art": ["Mosaic Art Collective"],
    "travel": ["Wanderwise Travel"],
    "class": ["Pulse Fitness Lab", "Kite Learning Hub", "Bloom & Basil Kitchen"],
    "newspaper|blog|newsletter": ["Sunday Paper Press", "Kite Learning Hub"],
    "christmas|anniversary|thank|halloween offer|black friday|cyber monday": ["Petal Post Gifts", "Harbor Lane Boutique",
                                                                             "Orbit Tech Store", "Greenway Grocers"],
}


def pick_brand(product: str, rng: random.Random):
    for pat, names in PRODUCT_BRANDS.items():
        if re.search(pat, product, re.I):
            name = rng.choice(names)
            return next(b for b in BRANDS if b[0] == name)
    return rng.choice(BRANDS)      # generic products (Onboarding, Order Confirmation, ...)


# ---------------------------------------------------------------- 1. cleaning
def clean_text(s: str, brand: str, product: str) -> str:
    s = str(s).replace("\r", "")
    s = re.sub(r"https?://\S+", "{{cta_link}}", s)        # before "/n" so URLs are not split
    s = s.replace("/n", "\n")
    # every spelling of the placeholders
    s = re.sub(r"\[\s*customer[ _]?name\s*\]", "{{first_name}}", s, flags=re.I)
    s = re.sub(r"\[\s*(your[ _])?company[ _]?name\s*\]", brand, s, flags=re.I)
    s = re.sub(r"\[\s*(your[ _])?product[ _]?name\s*\]", product, s, flags=re.I)
    s = re.sub(r"https?://\S+", "{{cta_link}}", s)
    # bracket CTAs like [BOOK_NOW] or [ Claim Your 15% Off Now ] -> plain CTA text
    s = re.sub(r"\[\s*([A-Za-z0-9 _%!'-]{2,60}?)\s*\]",
               lambda m: m.group(1).replace("_", " ").strip().capitalize(), s)
    return s


def strip_signatures(body: str) -> str:
    lines = body.split("\n")
    out, skip_next = [], 0
    for ln in lines:
        if SIG_RE.match(ln):
            skip_next = 2          # the 1-2 lines after "Warm regards," are names/team
            continue
        if skip_next and (ln.strip() == "" or "{{first_name}}" in ln or "Team" in ln or len(ln.split()) <= 4):
            skip_next -= 1
            if ln.strip() == "":
                continue
            continue
        skip_next = 0
        out.append(ln)
    text = "\n".join(out)
    text = re.sub(r"-{3,}", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


ARTIFACT_LINE_RE = re.compile(
    r"(?i)(characters? long|character count|word count|length:|^\s*\(?(email )?body copy|^\s*subject( line)?:"
    r"|^\s*email \d|^\s*preview text:)")
ID_RE = re.compile(r"\b[A-Z]{2,}-?\d{3,}\b")          # made-up order / ticket IDs
SPAM_REWRITE = {r"(?i)limited[- ]time offer": "special offer", r"(?i)click here now": "see the details",
                r"(?i)act now!+": "take a look today", r"!{2,}": "!"}


UNGROUNDED_RE = re.compile(
    r"(?i)(testimonial|^\s*[\"“].*[\"”]\s*(-|–)|\s(-|–)\s?[A-Z][a-z]+ [A-Z]\.\s*$|thousands|millions|"
    r"\b\d[\d,]*\+?\s+(customers|users|members|people|readers)\b|"
    r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\b\s*\d|"
    r"\buntil\s+(this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|"
    r"\b(this|on|every)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)")


def drop_ungrounded(body: str) -> str:
    """Drop sentences with facts the brand context can never support (quotes, dates, crowd sizes)."""
    out = []
    for ln in body.split("\n"):
        parts = re.split(r"(?<=[.!?])\s+", ln)
        parts = [p for p in parts if not UNGROUNDED_RE.search(p)]
        out.append(" ".join(parts))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip()


def scrub(body: str) -> str:
    """Remove leftovers from the LLM that generated this synthetic dataset."""
    body = drop_ungrounded(body)
    body = re.sub(r"!\[[^\]]*\]\([^)]*\)?", "", body)              # markdown images
    body = re.sub(r"\s*\(\\?\{\{cta_link\}\}[^)\n]*\)?", ": {{cta_link}}", body)   # broken markdown links
    keep = []
    for ln in body.split("\n"):
        if ARTIFACT_LINE_RE.search(ln) or ID_RE.search(ln):
            continue
        keep.append(ln)
    body = "\n".join(keep)
    # a second greeting inside the same email ("Hi X, ... Hello X,")
    greet = list(re.finditer(r"(?im)^\s*(hi|hello|dear|hey)\b[^\n]*\{\{first_name\}\}[^\n]*$", body))
    for m in reversed(greet[1:]):
        body = body[:m.start()] + body[m.end():]
    for pat, rep in SPAM_REWRITE.items():
        body = re.sub(pat, rep, body)
    body = re.sub(r"(?m)^\s*\{\{brand\}\}\s+team\s*$", "", body, flags=re.I)   # stray signature
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def words(s: str) -> int:
    return len(s.split())


# ---------------------------------------------------------------- 4. grounding
NO_OFFER_RE = re.compile(r"(?i)\b(discounts?|promo|code|% off|off your|expire[sd]?|hours?|offer(s|ing)?|deals?|sale|"
                         r"save|savings|ends soon|last chance|won.t last|limited time|hurry|claim|free|freebie|coupon)\b")


def rewrite_facts(text: str, offer: dict | None) -> str:
    """Make every number / code in the email match the context (or remove it)."""
    if offer is None:
        # drop every sentence that carries an offer, price or code
        parts = re.split(r"(?<=[.!?])\s+|\n", text)
        keep = [p for p in parts if not (NUM_FACT_RE.search(p) or CODE_RE.search(p)
                                         or NO_OFFER_RE.search(p))]
        text = "\n".join(p for p in keep if p.strip())
        return re.sub(r"\n{3,}", "\n\n", text).strip()
    text = re.sub(r"\d+(?:\.\d+)?%", f"{offer['pct']}%", text)
    text = re.sub(r"\$\s?\d[\d,]*(?:\.\d+)?", f"${offer['min_spend']}", text)
    text = re.sub(r"\b\d+x\b", "", text)
    text = re.sub(r"(?i)\b\d+\s*hours?\b", "48 hours", text)
    text = CODE_RE.sub(offer["code"], text)
    return text


def tidy_body(body: str) -> str:
    body = body.strip()
    if not re.match(r"(?i)^(hi|hello|dear|hey)\b", body):
        body = "Hi {{first_name}},\n\n" + body.lstrip("{}first_name,: \n")
    body = re.sub(r"(?m)^\s*\{\{first_name\}\},?\s*$\n?", "", body, count=0) if body.count("{{first_name}}") > 2 else body
    return re.sub(r"\n{3,}", "\n\n", body).strip()


def trim_words(body: str, limit: int = 140) -> str:
    if words(body) <= limit:
        return body
    sents = re.split(r"(?<=[.!?])\s+", body)
    out = []
    for s in sents:
        if words(" ".join(out + [s])) > limit:
            break
        out.append(s)
    return " ".join(out).strip()


# ---------------------------------------------------------------- 5. prompt (= emailPrompt.js)
def build_prompt(context: str, campaign_goal: str, audience: str) -> str:
    context_block = ("Brand context:\n" + context + "\n\n") if context else ""
    return (context_block
            + "You are an email marketing specialist.\n"
            + "Write a 3-step email drip sequence for the following campaign.\n\n"
            + "Campaign goal: " + campaign_goal + "\n"
            + "Audience: " + audience + "\n\n"
            + "Rules:\n"
            + "1. Each email must be relevant to the campaign goal and audience.\n"
            + "2. Keep each email body under 150 words.\n"
            + "3. REQUIRED: Every email body MUST end with this exact line:\n"
            + "   " + UNSUB + "\n"
            + "4. Do NOT omit the unsubscribe line from any email - it is legally required.\n"
            + "5. send_at_days: email 1 = 0, email 2 = 3, email 3 = 7.\n"
            + "6. Use ONLY prices, discounts and promo codes that appear in the brand context. "
            + "If the context has no offer, do not invent one.\n\n"
            + "Return ONLY valid JSON with no markdown:\n"
            + '{"emails":[{"email_index":1,"subject":"...","body":"...","send_at_days":0},'
            + '{"email_index":2,"subject":"...","body":"...","send_at_days":3},'
            + '{"email_index":3,"subject":"...","body":"...","send_at_days":7}]}')


# ---------------------------------------------------------------- 6. guardrails (= guardrails.js + grounding)
def guardrail_flags(emails: list, context: str) -> list:
    flags = []
    for e in emails:
        text = f"{e['subject']} {e['body']}"
        if PII_RE.search(text):
            flags.append("PII")
        if not re.search(r"(?i)unsubscribe|opt.?out|reply\s+stop", e["body"]):
            flags.append("UNSUBSCRIBE")
        if any(w in text.lower() for w in SPAM_WORDS):
            flags.append("SPAM")
        if len(re.findall(r"[A-Z]{4,}", text.replace("STOP", ""))) > 3:
            flags.append("TONE")
        for fact in NUM_FACT_RE.findall(text):
            if fact.replace(" ", "") not in context.replace(" ", ""):
                flags.append("HALLUCINATION:" + fact)
        for code in CODE_RE.findall(text):
            if code not in context:
                flags.append("HALLUCINATION:" + code)
        if words(e["body"]) > 150 or words(e["body"]) < 25:
            flags.append("LENGTH")
        if ID_RE.search(text) or re.search(r"(?i)characters long|body copy", text):
            flags.append("ARTIFACT")
    return flags


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--out", default="data")
    ap.add_argument("--n", type=int, default=900, help="number of sequences to try to build")
    ap.add_argument("--val-products", type=int, default=5)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    report = Counter()

    df = pd.read_csv(a.csv).dropna(subset=["body", "subject", "description"])
    report["rows_raw"] = len(df)

    # 1-2. clean bodies once with a neutral brand token, filter, de-duplicate
    rows, seen = [], set()
    for _, r in df.iterrows():
        body = scrub(strip_signatures(clean_text(r["body"], "{{brand}}", "{{product}}")))
        subj = scrub(clean_text(r["subject"], "{{brand}}", "{{product}}")).replace("\n", " ").strip()
        key = re.sub(r"\W+", "", body.lower())[:120]
        if key in seen:
            report["drop_duplicate"] += 1
            continue
        seen.add(key)
        if not (35 <= words(body) <= 200):
            report["drop_length"] += 1
            continue
        if PII_RE.search(body):
            report["drop_pii"] += 1
            continue
        stage = 3 if r["is_urgency"] == 1 else (2 if (r["is_discount"] == 1 or r["is_quote"] == 1) else 1)
        rows.append(dict(product=str(r["product"]), category=r["category"], audience=r["target_audience"],
                         goal=str(r["description"]).strip(), subject=subj, body=body, stage=stage,
                         discount=int(r["is_discount"] == 1)))
    report["rows_clean"] = len(rows)

    by_prod = defaultdict(lambda: defaultdict(list))
    for x in rows:
        by_prod[x["product"]][x["stage"]].append(x)

    # 7. product-level split
    products = sorted(by_prod)
    rng.shuffle(products)
    val_products = set(products[: a.val_products])

    # 3-6. build sequences
    examples = {"train": [], "val": []}
    tries = 0
    while sum(len(v) for v in examples.values()) < a.n and tries < a.n * 6:
        tries += 1
        prod = rng.choice(products)
        st = by_prod[prod]
        pool_all = [x for s in (1, 2, 3) for x in st[s]]
        if len(pool_all) < 3:
            continue
        has_offer = rng.random() > 0.55   # many no-offer tries fail, so this ends near 80/20
        if not has_offer:
            pool_all = [x for x in pool_all if not x["discount"]]
            if len(pool_all) < 3:
                continue
        pick = []
        for s in (1, 2, 3):                      # prefer the right stage, fall back to any email
            cands = [x for x in st[s] if x not in pick and x in pool_all] or [x for x in pool_all if x not in pick]
            pick.append(rng.choice(cands))
        brand, tone = pick_brand(prod, rng)
        offer = None
        facts = [f"{brand} uses a {tone} tone.",
                 f"Product / campaign focus: {prod}.",
                 "Always address the reader with {{first_name}} and link actions to {{cta_link}}."]
        if has_offer:
            offer = dict(pct=rng.choice([10, 15, 20, 25, 30]),
                         code=rng.choice(CODE_WORDS) + str(rng.choice([10, 15, 20, 25, 30])),
                         min_spend=rng.choice([25, 40, 50, 75, 100]))
            offer["code"] = re.sub(r"\d+$", str(offer["pct"]), offer["code"])
            facts.append(f"Current offer: {offer['pct']}% off with promo code {offer['code']} "
                         f"on orders over ${offer['min_spend']}. The offer ends in 48 hours.")
        else:
            facts.append("There is no discount or promo code running at the moment.")
        context = "\n---\n".join(facts)

        emails, ok = [], True
        for i, x in enumerate(pick):
            body = x["body"].replace("{{brand}}", brand).replace("{{product}}", prod)
            subj = x["subject"].replace("{{brand}}", brand).replace("{{product}}", prod)
            body = rewrite_facts(body, offer)
            subj = rewrite_facts(subj, offer) or f"{prod} from {brand}"
            if not subj.strip() or (offer is None and (NUM_FACT_RE.search(subj) or CODE_RE.search(subj)
                                                         or NO_OFFER_RE.search(subj))):
                subj = rng.choice([f"{{{{first_name}}}}, something new from {brand}",
                                   f"A quick note from {brand}", f"{prod}: what's new for you",
                                   f"{{{{first_name}}}}, we thought you'd like this"])
            body = trim_words(tidy_body(body), 130)
            if words(body) < 25:
                ok = False
                break
            if any(subj.strip().lower() == e["subject"].lower() for e in emails):
                ok = False
                break
            body = body.rstrip() + "\n\n" + UNSUB
            emails.append({"email_index": i + 1, "subject": subj.strip()[:90], "body": body,
                           "send_at_days": SEND_DAYS[i]})
        if not ok:
            report["drop_short_or_repeated_subject"] += 1
            continue

        goal = re.sub(r"(?i),?\s*(with|without)\s+(no\s+)?(discounts?|urgency)[^.]*", "", pick[0]["goal"])
        goal = rewrite_facts(goal, offer) or f"Promote {prod} to {pick[0]['audience']}"
        flags = guardrail_flags(emails, context + " " + goal)
        if flags:
            report["drop_guardrail_" + flags[0].split(":")[0]] += 1
            continue

        prompt = build_prompt(context, goal, pick[0]["audience"])
        answer = json.dumps({"emails": emails}, ensure_ascii=False)
        split = "val" if prod in val_products else "train"
        examples[split].append({"messages": [{"role": "user", "content": prompt},
                                             {"role": "assistant", "content": answer}],
                                "meta": {"product": prod, "has_offer": has_offer}})

    for split, exs in examples.items():
        # de-duplicate identical answers
        uniq = {e["messages"][1]["content"]: e for e in exs}.values()
        with open(out / f"{split}.jsonl", "w", encoding="utf-8") as f:
            for e in uniq:
                f.write(json.dumps({"messages": e["messages"]}, ensure_ascii=False) + "\n")
        report[f"{split}_examples"] = len(uniq)
        report[f"{split}_with_offer"] = sum(e["meta"]["has_offer"] for e in uniq)
    report["val_products"] = ", ".join(sorted(val_products))
    (out / "build_report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
