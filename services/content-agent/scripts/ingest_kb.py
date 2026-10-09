'''Seed explicitly synthetic demonstration knowledge, never claimed as real evidence.'''
import argparse
import json
import os
import sys
import uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

try:
    import psycopg2
    import requests
    from dotenv import load_dotenv
except ModuleNotFoundError as error:
    if error.name not in {'psycopg2', 'requests', 'dotenv'}:
        raise
    project_python = ROOT / '.venv' / 'bin' / 'python'
    if (__name__ == '__main__' and project_python.is_file()
            and Path(sys.prefix).resolve() != (ROOT / '.venv').resolve()):
        print('Using project .venv for ingestion dependencies.', flush=True)
        os.execv(str(project_python), [str(project_python), str(Path(__file__).resolve()), *sys.argv[1:]])
    raise SystemExit(
        f'Missing Python dependency: {error.name}.\n'
        f'Install project dependencies from {ROOT}:\n'
        '  python3 -m venv .venv\n'
        '  .venv/bin/python -m pip install -r requirements.txt\n'
        'Then run: .venv/bin/python scripts/ingest_kb.py'
    ) from None

load_dotenv(ROOT / '.env')

def tenant_arg(parser):
    parser.add_argument('--tenant-id', default=os.getenv('TENANT_ID'))
    args = parser.parse_args()
    if not args.tenant_id:
        parser.error('Supply --tenant-id with the UUID returned by registration, or set TENANT_ID')
    args.tenant_id = str(uuid.UUID(args.tenant_id))
    return args

def connect():
    return psycopg2.connect(os.getenv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/ai_marketing_dev'), connect_timeout=5)

def scoped(cur, tenant, sql, params=()):
    cur.execute("SELECT set_config('app.current_tenant', %s, true)", (tenant,))
    cur.execute(sql, params)

def embedding(text):
    response = requests.post(os.getenv('OLLAMA_HOST', 'http://localhost:11434') + '/api/embeddings', json={'model': os.getenv('EMBEDDING_MODEL', 'nomic-embed-text'), 'prompt': text, 'stream': False}, timeout=180)
    response.raise_for_status()
    vector = response.json()['embedding']
    import math
    if len(vector) != 768 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in vector):
        raise ValueError('Expected finite 768-dimensional embedding')
    return vector

ENTRIES = [
 ('brand_voice', 'Use a direct, results-driven, empowering tone. Explain clear outcomes with concrete steps; avoid hype and unsupported promises.'),
 ('brand', 'Growth Lab is a fictional small-business marketing education brand focused on practical campaign planning.'),
 ('brand', 'Growth Lab teaches founders how to articulate offers and test messages using measurable experiments.'),
 ('product', 'The Campaign Foundations workshop covers audience research, offer design and ad drafting.'),
 ('product', 'The workshop includes a campaign worksheet and a guided message-review exercise. No price or date has been announced.'),
 ('product', 'The free Campaign Checklist helps founders review their audience, offer and call to action.'),
 ('audience', 'Primary audience: early-stage founders who manage their own marketing and have limited time.'),
 ('audience', 'Secondary audience: independent consultants seeking a repeatable approach to explaining their services.'),
 ('audience', 'The audience responds to practical examples and plain language rather than technical jargon.'),
 ('proven_hook', 'Synthetic example only: "Your next campaign starts with one clear offer" achieved 2.4% CTR in a simulated 10000-impression test.'),
 ('proven_hook', 'Synthetic example only: "Turn a scattered idea into a campaign plan" achieved 2.1% CTR in a simulated 8000-impression test.'),
 ('proven_hook', 'Synthetic example only: "Before you launch, check these five details" achieved 3.0% CTR in a simulated 5000-impression test.'),
 ('failed_hook', 'Synthetic negative example: "Guaranteed overnight success" produced 0.3% CTR and makes an unsupported promise. Avoid it.'),
 ('failed_hook', 'Synthetic negative example: "The ultimate revolutionary solution" produced 0.4% CTR. Avoid vague hype.'),
 ('campaign_result', 'Synthetic campaign A: 10000 impressions, 240 clicks, 24 checklist signups; CTR 2.4%, click-to-signup 10%. Not real customer evidence.'),
 ('campaign_result', 'Synthetic campaign B: 8000 impressions, 168 clicks, 21 checklist signups; CTR 2.1%, click-to-signup 12.5%. Not real customer evidence.'),
 ('objection', 'Objection: I do not have time. Response: start with one worksheet and one message experiment; do not promise a specific completion time.'),
 ('objection', 'Objection: I am new to marketing. Response: the foundations workshop uses plain-language exercises without assuming prior marketing training.'),
 ('audience_insight', 'Hypothesis for testing: busy founders prefer a concrete checklist to a long theoretical explanation. This is not a measured customer finding.'),
 ('value_proposition', 'Build a clearer offer, a better-defined audience and a practical plan for testing campaign messages.')
]

def seed(tenant, entries, namespace='demo-kb'):
    conn = connect()
    try:
        with conn:
            with conn.cursor() as cur:
                scoped(cur, tenant, 'SELECT id FROM clients WHERE id = %s', (tenant,))
                if not cur.fetchone():
                    raise ValueError('Tenant does not exist; register first')
                for index, (kind, text) in enumerate(entries):
                    entry_id = str(uuid.uuid5(uuid.UUID(tenant), f'{namespace}:{index}'))
                    vector = embedding(text)
                    scoped(cur, tenant, '''INSERT INTO knowledge_base (entry_id,tenant_id,type,text,embedding,metadata,created_at)
                        SELECT %s,%s,%s,%s,%s::vector,%s::jsonb,NOW() WHERE %s::uuid = current_setting('app.current_tenant')::uuid
                        ON CONFLICT (entry_id) DO UPDATE SET text=EXCLUDED.text,embedding=EXCLUDED.embedding,metadata=EXCLUDED.metadata
                        WHERE knowledge_base.tenant_id = %s''', (entry_id,tenant,kind,text,json.dumps(vector),json.dumps({'source':namespace,'synthetic':True}),tenant,tenant))
                    print(f'✅ {index+1:02d}/{len(entries)} {kind}: {text[:75]}')
                scoped(cur,tenant,"SELECT COUNT(*) FROM knowledge_base WHERE tenant_id = %s AND metadata->>'source' = %s",(tenant,namespace))
                count = cur.fetchone()[0]
        # PP1 evidence — screenshot this output
        print(f'✅ COMMITTED: {len(entries)} entries ingested; verified source count = {count}; tenant = {tenant}')
        print('All seeded examples and campaign metrics are SYNTHETIC, not real performance evidence.')
    finally:
        conn.close()

if __name__ == '__main__':
    args = tenant_arg(argparse.ArgumentParser(description=__doc__))
    seed(args.tenant_id, ENTRIES)
