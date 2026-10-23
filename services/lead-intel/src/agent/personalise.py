# services/lead-intel/src/agent/personalise.py — talking points for ONE lead, from its own CRM record
# The next step follows the company rule for the lead's group (same for every hot lead, on purpose).
# These points make the contact personal: they come only from this lead's data, so two leads with
# different behaviour get different points. Rules only, no LLM: instant, repeatable and testable.
import math

CHANNEL = {
    "Email Opened": "Opened your last email - reply by email, it reaches them.",
    "Email Link Clicked": "Clicked a link in your email - follow up on that topic.",
    "View in browser link Clicked": "Read your email in the browser - follow up on that email.",
    "Email Received": "Received your email - ask if they had time to read it.",
    "SMS Sent": "You already sent them an SMS - check for a reply before calling.",
    "Olark Chat Conversation": "Chatted with you on the website - continue from that chat.",
    "Live Chat": "Chatted with you on the website - continue from that chat.",
    "Page Visited on Website": "Visited your website recently - send the page they looked at.",
    "Converted to Lead": "Just became a lead - contact them while the interest is fresh.",
    "Form Submitted on Website": "Filled in a form on your website - confirm what they asked for.",
    "Had a Phone Conversation": "Already spoke to you on the phone - follow up on that call.",
    "Approached upfront": "Already approached in person - follow up on that talk.",
    "Visited Booth in Tradeshow": "Met you at a trade show - mention the event.",
    "Email Bounced": "Their email bounced - check the email address before writing again.",
    "Email Marked Spam": "Marked your email as spam - do not email; use another channel.",
    "Unsubscribed": "Unsubscribed from your emails - do not email; use another channel.",
    "Resubscribed to emails": "Subscribed to your emails again - a good moment to write.",
    "Unreachable": "Could not be reached before - try a different time or channel.",
}
SOURCE = {
    "Reference": "Came through a referral - mention who referred them, if you know.",
    "Google": "Found you on Google - they are actively searching, so reply quickly.",
    "Organic Search": "Found you through search - they are actively looking, so reply quickly.",
    "Direct Traffic": "Typed your website address directly - they already know your name.",
    "Welingak Website": "Came from the Welingak partner website - mention it.",
    "Referral Sites": "Came from another website that links to you - mention it.",
    "Facebook": "Came from Facebook - a short, friendly message works best.",
    "Olark Chat": "Started on your website chat - keep the same friendly tone.",
}
JOB = {
    "Working Professional": "Working professional - suggest a time outside office hours.",
    "Student": "Student - mention study-friendly timing and payment options.",
    "Unemployed": "Looking for work - explain how this can help them get a job.",
    "Businessman": "Runs a business - focus on what it brings to their business.",
    "Housewife": "Managing a home - mention flexible timing.",
}


def _num(v) -> float:
    try:
        f = float(v)
        return 0.0 if math.isnan(f) else f
    except (TypeError, ValueError):
        return 0.0


def _text(v) -> str | None:
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return None
    s = str(v).strip()
    return None if not s or s.lower() in {"select", "unknown", "nan"} else s


def talking_points(lead: dict, limit: int = 4) -> list[str]:
    """Up to `limit` plain-English points about this lead, most useful first."""
    points = []
    act = _text(lead.get("last_activity"))
    points.append(CHANNEL.get(act, "No activity yet - introduce yourself briefly.") if act else
                  "No activity yet - introduce yourself briefly.")

    visits, secs = _num(lead.get("total_visits")), _num(lead.get("time_on_site_sec"))
    if visits == 0 or secs == 0:
        points.append("Has not spent time on your website yet - send the main course page first.")
    elif secs >= 900:
        points.append(f"Spent {round(secs / 60)} minutes on your website over {int(visits)} visits - "
                      "very engaged, ask what they liked.")
    elif secs >= 300:
        points.append(f"Spent about {round(secs / 60)} minutes on your website - real interest, answer their questions.")
    else:
        points.append(f"Only {int(secs)} seconds on your website - keep the first message short and simple.")

    spec = _text(lead.get("specialization"))
    if spec:
        points.append(f"Interested in {spec} - start the conversation with this topic.")
    job = _text(lead.get("occupation"))
    if job in JOB:
        points.append(JOB[job])
    src = _text(lead.get("source"))
    if src in SOURCE:
        points.append(SOURCE[src])
    return points[:limit]
