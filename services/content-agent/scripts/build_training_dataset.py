'''Export positively rated generations for later training; does not train a model.'''
import argparse
import json
from ingest_kb import ROOT, tenant_arg, connect, scoped

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default=str(ROOT/'data/training.jsonl'))
    args = tenant_arg(parser)
    conn = connect()
    try:
        with conn, conn.cursor() as cur:
            scoped(cur,args.tenant_id,'''SELECT g.id,g.input_params,g.output,p.prompt_snapshot
                FROM generations g LEFT JOIN LATERAL (
                  SELECT prompt_snapshot FROM prompt_performance
                  WHERE tenant_id=%s AND prompt_hash=g.prompt_hash AND agent_type=g.agent_type AND sub_type=g.sub_type
                  ORDER BY created_at DESC LIMIT 1
                ) p ON true WHERE g.tenant_id=%s AND g.rating='positive' ORDER BY g.created_at''',(args.tenant_id,args.tenant_id))
            rows = cur.fetchall()
        from pathlib import Path
        output = Path(args.output)
        output.parent.mkdir(parents=True,exist_ok=True)
        with output.open('w') as stream:
            for generation_id,params,result,snapshot in rows:
                snapshot = snapshot or {}
                record = {'id':str(generation_id),'messages':[{'role':'system','content':snapshot.get('system','Write truthful marketing content as JSON.')},{'role':'user','content':snapshot.get('user',json.dumps(params))},{'role':'assistant','content':result}]}
                stream.write(json.dumps(record)+'\n')
        output.chmod(0o600)
        print(f'✅ Exported {len(rows)} positive examples to {output}; no training performed.')
    finally:
        conn.close()

if __name__ == '__main__':
    main()
