import argparse
from ingest_kb import tenant_arg, seed

PROFILES = [
 ('brand_voice','Hormozi-inspired profile: direct, value-focused, concise. Explain outcomes, effort and practical tradeoffs. Use original language; never imply endorsement or invent earnings.'),
 ('brand_voice','Brunson-inspired profile: use an original short story, explain the problem and bridge to a clear offer. Conversational and energetic. Never imply endorsement or invent testimonials.'),
 ('brand_voice','Ogilvy-inspired profile: research-led, specific, benefit-focused copy with a clear headline and credible supporting detail. Use original wording. Never imply endorsement or invent facts.')
]

if __name__ == '__main__':
    args = tenant_arg(argparse.ArgumentParser(description='Seed three original style profiles, not quotations or endorsements'))
    seed(args.tenant_id,PROFILES,'brand-voice-profiles')
