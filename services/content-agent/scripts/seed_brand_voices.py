import psycopg2, json, requests, os, argparse

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

BRAND_VOICES = [
    ('hormozi', 'BRAND VOICE: Alex Hormozi Style\nCORE STYLE: Direct, value-first, outcome-led, no fluff, mathematical proof.\nFRAMEWORKS: Value equation, Grand Slam Offer stacking, numbered value stacks.\nTONE: Blunt, confident, never hype. Show the math.\nPATTERNS: Lead with specific outcome. Use numbers and specificity. Stack value explicitly. Address objections head-on. End with risk reversal.\nAVOID: Vague benefits, hype words, filler phrases, passive voice.\nEXAMPLE: "I went from $100/month to $100M/year. Here are the 3 things nobody tells you."'),
    ('brunson', 'BRAND VOICE: Russell Brunson Style\nCORE STYLE: Story-driven, epiphany-bridge framework, funnel-focused, community-building.\nFRAMEWORKS: Epiphany Bridge Story, Hero Journey, Before/After/Bridge.\nTONE: Warm, enthusiastic, personal, like a friend sharing a secret.\nPATTERNS: Open with "I used to believe X until something changed everything". Create curiosity gaps. Build community identity. Use future pacing.\nAVOID: Hard sell language, aggressive urgency without story, generic benefits.\nEXAMPLE: "I was $1M in debt and about to quit when I discovered the one funnel that saved everything."'),
    ('ogilvy', 'BRAND VOICE: David Ogilvy Style\nCORE STYLE: Research-driven, specific numbers, headline carries 80% of weight, long-form converts.\nFRAMEWORKS: Reason-why advertising. Specificity over generality.\nTONE: Authoritative, respectful of reader intelligence, precise.\nPATTERNS: Headlines contain specific numbers. Lead with most important fact. Use testimonials with full names and specific results. Research-backed claims.\nAVOID: Superlatives without proof, cleverness that obscures the message, vague promises.\nEXAMPLE: "At 60 miles an hour, the loudest noise in the new Rolls-Royce comes from the electric clock."'),
]

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tenant-id', required=True)
    args = parser.parse_args()

    print(f'Seeding 3 brand voices for tenant: {args.tenant_id}')
    for key, content in BRAND_VOICES:
        ingest(args.tenant_id, 'brand_voice', content)
        print(f'  ✅ {key} brand voice added')

    conn = psycopg2.connect(**DB)
    with conn.cursor() as cur:
        cur.execute('SET row_security = off')
        cur.execute(
            "SELECT COUNT(*) FROM knowledge_base WHERE tenant_id = %s AND type = 'brand_voice'",
            [args.tenant_id]
        )
        count = cur.fetchone()[0]
    conn.close()

    print(f'\n✅ Total brand voices: {count}')
    print('📸 Screenshot this for C1-12 PP1 evidence')
