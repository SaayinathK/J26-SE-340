import argparse
import json
from ingest_kb import tenant_arg, connect, scoped, embedding

def retrieve_top_k(tenant, text, k=5):
    vector = embedding(text)
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            scoped(cur,tenant,'''SELECT entry_id,text,type,1-(embedding <=> %s::vector) AS score
                FROM knowledge_base WHERE tenant_id=%s AND embedding IS NOT NULL
                ORDER BY embedding <=> %s::vector LIMIT %s''',(json.dumps(vector),tenant,json.dumps(vector),k))
            return cur.fetchall()
    finally:
        conn.close()

def main():
    parser = argparse.ArgumentParser(description='Top-k cosine retrieval and tenant isolation verification')
    parser.add_argument('--query',default='Practical workshop campaign for early-stage founders')
    args = tenant_arg(parser)
    rows = retrieve_top_k(args.tenant_id,args.query)
    for entry_id,text,kind,score in rows:
        print(f'{entry_id} | {kind} | cosine={score:.4f} | {text}')
    # PP1 evidence — screenshot this output
    print('\nISOLATION TEST')
    conn, passed = connect(), bool(rows)
    try:
        with conn, conn.cursor() as cur:
            for entry_id,*_ in rows:
                scoped(cur,args.tenant_id,'SELECT tenant_id FROM knowledge_base WHERE tenant_id=%s AND entry_id=%s',(args.tenant_id,str(entry_id)))
                owner = cur.fetchone()
                ok = owner is not None and str(owner[0]) == args.tenant_id
                passed = passed and ok
                print(f'{"✅ PASS" if ok else "❌ LEAK"}: {entry_id}')
        print('✅ PASS: all returned entries verified' if passed else '❌ FAIL: empty retrieval or isolation failure')
        return 0 if passed else 1
    finally:
        conn.close()

if __name__ == '__main__':
    raise SystemExit(main())
