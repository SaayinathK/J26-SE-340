"""A closed channel vocabulary. Using it in the generator, the simulator AND the sharing pipeline means a tenant-specific
custom channel name (which could carry a brand name) is generalised to `other_channel` before it can reach the shared store."""
from __future__ import annotations

import re

CHANNEL_VOCAB: tuple[str, ...] = (
    "meta_ads", "google_ads", "tiktok_ads", "linkedin_ads", "youtube_ads", "display_ads", "email", "sms", "whatsapp", "social",
    "seo", "content_marketing", "influencer", "landing_page", "events", "webinar", "referral", "affiliate", "pr", "direct_mail",
)
_ALIASES = {
    "facebook": "meta_ads", "instagram": "meta_ads", "meta": "meta_ads", "facebook_ads": "meta_ads", "instagram_ads": "meta_ads",
    "google": "google_ads", "adwords": "google_ads", "search_ads": "google_ads", "sem": "google_ads", "ppc": "google_ads",
    "newsletter": "email", "email_marketing": "email", "edm": "email", "text": "sms",
    "blog": "content_marketing", "content": "content_marketing", "organic_social": "social", "social_media": "social",
    "search_engine_optimization": "seo", "influencers": "influencer", "partnerships": "affiliate",
}
OTHER = "other_channel"


def canonical_channel(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    if key in CHANNEL_VOCAB:
        return key
    return _ALIASES.get(key, OTHER)


def canonical_mix(mix: dict[str, float]) -> dict[str, float]:
    out: dict[str, float] = {}
    for ch, share in mix.items():
        c = canonical_channel(ch)
        out[c] = out.get(c, 0.0) + float(share)
    total = sum(out.values())
    return {c: round(v / total, 4) for c, v in sorted(out.items())} if total > 0 else {}
