import psycopg2, json, requests, os, sys, argparse

OLLAMA = os.getenv('OLLAMA_HOST', 'http://localhost:11434')
DB = dict(host='localhost', port=5432, dbname='ai_marketing_dev',
          user='postgres', password='postgres')

def embed(text):
    r = requests.post(f'{OLLAMA}/api/embeddings',
        json={'model':'nomic-embed-text','prompt':text}, timeout=30)
    return r.json()['embedding']

def ingest(tenant_id, type_, text):
    conn = psycopg2.connect(**DB)
    with conn.cursor() as cur:
        cur.execute('SET row_security = off')
        cur.execute(
            'INSERT INTO knowledge_base(tenant_id, type, text, embedding) VALUES(%s,%s,%s,%s::vector)',
            [tenant_id, type_, text, json.dumps(embed(text))]
        )
    conn.commit(); conn.close()
    print(f'  ✅ [{type_}] {text[:70]}')

ENTRIES = [
    ('brand_voice', 'Our brand voice is direct, results-driven, and empowering. We speak to ambitious entrepreneurs who want real outcomes. Use short punchy sentences. Lead with the outcome not the process. Never be vague.'),
    ('brand', 'Elev8 Montreal is a premium 2-day business event for entrepreneurs, real estate investors, and business owners in Montreal, Quebec, Canada.'),
    ('brand', 'Elev8 tickets are priced at $497 CAD. The event runs annually and attracts 300-400 high-calibre attendees per year.'),
    ('product', 'The event features keynote speakers including top Canadian real estate investors, 7-figure business owners, and marketing experts.'),
    ('product', 'Attendees receive lifetime access to session recordings, a private networking community, and a 90-day accountability program after the event.'),
    ('product', 'The free Campaign Checklist helps attendees review their audience, offer and call to action before the event.'),
    ('audience', 'Primary audience: entrepreneurs and business owners aged 28-55 actively growing revenue beyond $100k/year who want to scale faster.'),
    ('audience', 'Secondary audience: real estate investors with 3-8 properties looking to scale to 10+ and find joint venture partners.'),
    ('audience', 'Our audience responds strongly to urgency — limited seats, early bird pricing, and specific social proof numbers from past attendees.'),
    ('proven_hook', 'High performer (4.2% CTR): "Montreal entrepreneurs: stop learning and start earning. 2 days that will change your trajectory."'),
    ('proven_hook', 'High performer (3.8% CTR): "The room that built 12 seven-figure businesses last year is opening its doors again."'),
    ('proven_hook', 'High performer (3.5% CTR): "Less than 200 seats left for the business event Montreal has been talking about."'),
    ('failed_hook', 'Low performer (0.6% CTR): "Join us for an amazing business conference in Montreal this fall!"'),
    ('failed_hook', 'Low performer (0.4% CTR): "Learn from experts at our upcoming event. Register now."'),
    ('campaign_result', 'September 2025 campaign: $4,200 ad spend generated 847 leads at $4.96 CPL. Best audience: lookalike of past attendees.'),
    ('campaign_result', 'Email urgency sequence open rate: 44% in final 72 hours before ticket price increase.'),
    ('objection', 'Common objection: too expensive. Counter: "One deal from the connections you make here pays for 10 tickets."'),
    ('objection', 'Common objection: no time. Counter: "Two days away to build the network that changes your next 10 years."'),
    ('audience_insight', 'Quebec French-speaking attendees convert 2.3x better when copy acknowledges bilingual business environment.'),
    ('value_proposition', 'Three outcomes every attendee reports: a high-value business contact, a strategy implemented within 30 days, renewed momentum.'),
]

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tenant-id', required=True)
    args = parser.parse_args()

    print(f'Ingesting 20 Elev8 Montreal KB entries for tenant: {args.tenant_id}')
    for type_, text in ENTRIES:
        ingest(args.tenant_id, type_, text)

    conn = psycopg2.connect(**DB)
    with conn.cursor() as cur:
        cur.execute('SET row_security = off')
        cur.execute('SELECT COUNT(*) FROM knowledge_base WHERE tenant_id = %s', [args.tenant_id])
        count = cur.fetchone()[0]
    conn.close()
    print(f'\n✅ Total KB entries: {count}')
    print('📸 Screenshot this for C1-01 PP1 evidence')
