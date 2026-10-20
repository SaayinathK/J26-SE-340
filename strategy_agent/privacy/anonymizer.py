"""PII detection / removal and generalisation. Runs fully on CPU; nothing here is simulated.

Detection has two layers that are always combined (defence in depth):
  1. Microsoft Presidio (spaCy `en_core_web_sm` NER + pattern recognisers) with an ad-hoc recogniser built from the
     tenant's own brand / business / product / competitor names.
  2. Our own regex layer (emails, phones, URLs, IPs, card-like numbers, and the same tenant names). It is also the
     complete fallback if Presidio / spaCy are not installed.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable, Optional, Sequence

log = logging.getLogger("strategy_agent.privacy")

PRESIDIO_ENTITIES = ["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "URL", "IP_ADDRESS", "CREDIT_CARD", "IBAN_CODE", "LOCATION", "US_SSN"]


@dataclass(frozen=True)
class Finding:
    entity: str
    start: int
    end: int


# ----------------------------------------------------------------------------------------------- regex layer
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", re.I)
_URL = re.compile(r"(?:https?://|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|co|lk|ai|app|biz|info|shop|store)(?:/\S*)?\b", re.I)
_PHONE = re.compile(r"(?<![\w.])\+?\(?\d[\d\s().-]{6,}\d(?!\w)")
_IP = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_CARD = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
_LEGAL_SUFFIX = re.compile(r"\b(?:pvt|private|ltd|limited|inc|incorporated|llc|corp|corporation|co|gmbh|plc)\.?\s*$", re.I)


def _digits(s: str) -> int:
    return sum(ch.isdigit() for ch in s)


def tenant_terms(profile: Optional[dict]) -> list[str]:
    """Names that identify a tenant or its competitors, plus sensible variants (legal suffix removed, first two words)."""
    if not profile:
        return []
    names: list[str] = []
    for key in ("business_name",):
        if profile.get(key):
            names.append(profile[key])
    for key in ("brand_names", "product_names", "competitor_names"):
        names.extend(n for n in (profile.get(key) or []) if n)
    terms: set[str] = set()
    for name in names:
        name = name.strip()
        if len(name) < 2:
            continue
        terms.add(name)
        stripped = name
        while True:  # peel repeated suffixes: "Acme Pvt Ltd" -> "Acme Pvt" -> "Acme"
            new = _LEGAL_SUFFIX.sub("", stripped).strip(" ,.")
            if new == stripped or not new:
                break
            stripped = new
        if len(stripped) >= 2:
            terms.add(stripped)
        words = stripped.split()
        if len(words) >= 3:
            terms.add(" ".join(words[:2]))
    return sorted(terms, key=len, reverse=True)


def _regex_findings(text: str, terms: Sequence[str]) -> list[Finding]:
    out: list[Finding] = []
    for m in _EMAIL.finditer(text):
        out.append(Finding("EMAIL_ADDRESS", m.start(), m.end()))
    for m in _URL.finditer(text):
        out.append(Finding("URL", m.start(), m.end()))
    for m in _IP.finditer(text):
        out.append(Finding("IP_ADDRESS", m.start(), m.end()))
    for m in _CARD.finditer(text):
        if 13 <= _digits(m.group()) <= 19:
            out.append(Finding("CREDIT_CARD", m.start(), m.end()))
    for m in _PHONE.finditer(text):
        d = _digits(m.group())
        if 9 <= d <= 15 or (d >= 7 and re.search(r"[+()\s.-]", m.group())):
            out.append(Finding("PHONE_NUMBER", m.start(), m.end()))
    for term in terms:
        for m in re.finditer(r"(?<!\w)" + re.escape(term) + r"(?!\w)", text, re.I):
            out.append(Finding("ORG_BRAND", m.start(), m.end()))
    return out


# ----------------------------------------------------------------------------------------------- Presidio layer
_ANALYZER = None
_ANALYZER_FAILED = False


def _get_analyzer():
    global _ANALYZER, _ANALYZER_FAILED
    if _ANALYZER is not None or _ANALYZER_FAILED:
        return _ANALYZER
    logging.getLogger("presidio-analyzer").setLevel(logging.ERROR)  # it warns about every unmapped spaCy label (CARDINAL, PERCENT...)
    try:
        from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
        from presidio_analyzer.nlp_engine import NlpEngineProvider

        nlp = NlpEngineProvider(nlp_configuration={"nlp_engine_name": "spacy", "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}]}).create_engine()
        registry = RecognizerRegistry()
        registry.load_predefined_recognizers(nlp_engine=nlp)
        _ANALYZER = AnalyzerEngine(nlp_engine=nlp, registry=registry, supported_languages=["en"])
    except Exception as exc:  # missing package / model: fall back to the regex layer
        log.warning("Presidio unavailable (%s); using the regex fallback only", type(exc).__name__)
        _ANALYZER_FAILED = True
    return _ANALYZER


class Anonymizer:
    def __init__(self, use_presidio: bool = True) -> None:
        self.use_presidio = use_presidio

    @property
    def engine(self) -> str:
        return "presidio+regex" if (self.use_presidio and _get_analyzer() is not None) else "regex"

    def scan(self, text: str, terms: Sequence[str] = ()) -> list[Finding]:
        if not text:
            return []
        findings = _regex_findings(text, terms)
        analyzer = _get_analyzer() if self.use_presidio else None
        if analyzer is not None:
            from presidio_analyzer import PatternRecognizer

            adhoc = [PatternRecognizer(supported_entity="ORG_BRAND", deny_list=list(terms))] if terms else None
            entities = PRESIDIO_ENTITIES + (["ORG_BRAND"] if terms else [])
            for r in analyzer.analyze(text=text, language="en", entities=entities, ad_hoc_recognizers=adhoc):
                findings.append(Finding(r.entity_type, r.start, r.end))
        return findings

    def entities_in(self, text: str, terms: Sequence[str] = ()) -> list[str]:
        """Entity TYPES only (safe to log). Never returns the matched text."""
        return sorted({f.entity for f in self.scan(text, terms)})

    def redact(self, text: str, terms: Sequence[str] = ()) -> str:
        spans = sorted((f.start, f.end, f.entity) for f in self.scan(text, terms))
        merged: list[list] = []
        for s, e, ent in spans:
            if merged and s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e, ent])
        out, pos = [], 0
        for s, e, ent in merged:
            out.append(text[pos:s])
            out.append(f"<{ent}>")
            pos = e
        out.append(text[pos:])
        return "".join(out)


# ----------------------------------------------------------------------------------------------- generalisation
_INDUSTRY_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("technology", ("saas", "software", "tech", "it services", "cloud", "ai ", "app", "cyber", "fintech", "telecom")),
    ("financial_services", ("bank", "insurance", "finance", "financial", "lending", "invest", "wealth")),
    ("health_wellness", ("health", "pharma", "medical", "clinic", "wellness", "fitness", "beauty", "hospital", "dental")),
    ("retail_ecommerce", ("retail", "ecommerce", "e-commerce", "fashion", "apparel", "grocery", "shop", "store", "consumer goods", "fmcg")),
    ("hospitality_travel", ("restaurant", "hotel", "hospitality", "travel", "tourism", "cafe", "food", "beverage", "tea")),
    ("education", ("education", "school", "university", "course", "training", "edtech", "tutor")),
    ("real_estate", ("real estate", "property", "construction", "housing")),
    ("industrial_b2b", ("manufactur", "industrial", "logistics", "wholesale", "engineering", "agri", "energy", "supply")),
    ("nonprofit", ("nonprofit", "non-profit", "charity", "ngo")),
    ("media_entertainment", ("media", "entertainment", "gaming", "music", "film", "publishing")),
]

_REGIONS: dict[str, tuple[str, ...]] = {
    "south_asia": ("sri lanka", "colombo", "kandy", "galle", "india", "mumbai", "delhi", "bangalore", "chennai", "pakistan", "bangladesh", "nepal", "maldives"),
    "asia_pacific": ("singapore", "malaysia", "thailand", "vietnam", "indonesia", "philippines", "japan", "tokyo", "korea", "china", "hong kong", "australia", "sydney", "melbourne", "new zealand"),
    "europe": ("united kingdom", "uk", "london", "germany", "berlin", "france", "paris", "spain", "italy", "netherlands", "sweden", "ireland", "poland", "europe"),
    "north_america": ("united states", "usa", "us", "new york", "california", "texas", "chicago", "canada", "toronto"),
    "latin_america": ("brazil", "argentina", "chile", "colombia", "peru", "mexico", "latin america"),
    "middle_east_africa": ("uae", "dubai", "saudi", "qatar", "israel", "turkey", "egypt", "nigeria", "kenya", "south africa"),
}

_ANGLES: list[tuple[str, tuple[str, ...]]] = [
    ("urgency_scarcity", ("limited", "urgent", "hurry", "last chance", "ends", "only today", "while stocks")),
    ("risk_reversal", ("free trial", "money back", "guarantee", "no risk", "try free", "demo", "refund")),
    ("price_value", ("discount", "save", "offer", "deal", "% off", "cheap", "affordable", "bargain", "sale")),
    ("premium_quality", ("premium", "luxury", "quality", "crafted", "authentic", "finest", "exclusive")),
    ("social_proof_community", ("join", "community", "customers love", "reviews", "rated", "testimonial", "thousands of")),
    ("sustainability_values", ("sustainab", "eco", "ethical", "organic", "green", "fair trade", "planet")),
    ("convenience_simplicity", ("easy", "simple", "fast", "quick", "effortless", "one click", "hassle")),
    ("trust_security", ("trust", "secure", "safe", "certified", "reliable", "privacy", "compliant")),
    ("education_expertise", ("learn", "guide", "expert", "insight", "how to", "tips", "webinar", "report")),
]
ANGLE_TAXONOMY = tuple(a for a, _ in _ANGLES) + ("general_value",)

# Closed vocabularies: a generalised field may only ever hold one of these values (checked again before anything is stored).
INDUSTRY_BUCKETS = frozenset(b for b, _ in _INDUSTRY_KEYWORDS) | {"other"}
REGION_BUCKETS = frozenset(_REGIONS) | {"other"}
BUDGET_BANDS = frozenset({"under_1k", "1k_5k", "5k_20k", "20k_100k", "over_100k", "undisclosed"})
DURATION_BUCKETS = frozenset({"short", "medium", "long", "unknown"})
PERIOD_PATTERN = re.compile(r"^(?:\d{4}-Q[1-4]|unknown)$")


def industry_bucket(industry: str) -> str:
    s = f" {industry.lower()} "
    for bucket, keys in _INDUSTRY_KEYWORDS:
        if any(k in s for k in keys):
            return bucket
    return "other"


def region_bucket(place: str) -> str:
    s = place.lower()
    for bucket, names in _REGIONS.items():
        if any(re.search(r"(?<!\w)" + re.escape(n) + r"(?!\w)", s) for n in names):
            return bucket
    return "other"


def budget_band(monthly_budget: float) -> str:
    for limit, label in ((1_000, "under_1k"), (5_000, "1k_5k"), (20_000, "5k_20k"), (100_000, "20k_100k")):
        if monthly_budget < limit:
            return label
    return "over_100k"


def period_bucket(iso_date: Optional[str]) -> str:
    """Exact dates become a quarter, e.g. 2026-Q3."""
    if not iso_date:
        return "unknown"
    try:
        d = datetime.fromisoformat(iso_date[:10]) if isinstance(iso_date, str) else iso_date
    except ValueError:
        return "unknown"
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


def duration_bucket(weeks: Optional[int]) -> str:
    if not weeks:
        return "unknown"
    return "short" if weeks <= 4 else "medium" if weeks <= 12 else "long"


def abstract_angle(text: str) -> str:
    """Free-text messaging -> one value from a fixed taxonomy. The output can never contain tenant text."""
    s = text.lower()
    for angle, keys in _ANGLES:
        if any(k in s for k in keys):
            return angle
    return "general_value"
