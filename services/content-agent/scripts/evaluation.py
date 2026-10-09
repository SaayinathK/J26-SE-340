'''Generate 20 blinded baseline/context pairs; score later with a separate key.'''
import argparse
import json
import os
import random
import uuid
import requests
from ingest_kb import ROOT

PROMPTS = [f'Write a Meta ad for the Campaign Foundations workshop focusing on {focus}. Invite readers to learn more.' for focus in [
 'clear offers','audience research','campaign planning','message testing','founder confidence','plain language','practical worksheets','first-time marketers','independent consultants','limited time','avoiding vague copy','defining a call to action','reviewing a message','learning through exercises','small-business needs','one campaign at a time','offer clarity','actionable learning','campaign foundations','a repeatable planning process']]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token',default=os.getenv('API_TOKEN'))
    parser.add_argument('--api-url',default='http://localhost:5001')
    parser.add_argument('--score',type=str,help='JSON ratings array with id, A and B scores from 1 to 5')
    parser.add_argument('--key',type=str,help='Private evaluation key file for scoring')
    args = parser.parse_args()
    if args.score:
        if not args.key:
            parser.error('--score requires --key')
        key = json.loads(open(args.key).read())
        ratings = json.loads(open(args.score).read())
        expected = {row['id']:row['labels'] for row in key}
        if len(ratings) != 20 or len({r['id'] for r in ratings}) != 20 or {r['id'] for r in ratings} != set(expected):
            parser.error('Ratings must cover all 20 unique pair IDs')
        totals = {'baseline':0,'context':0}
        for row in ratings:
            for label in ('A','B'):
                value = row[label]
                if not isinstance(value,(int,float)) or not 1 <= value <= 5:
                    parser.error('Scores must be 1–5')
                totals[expected[row['id']][label]] += value
        print(json.dumps({name:score/20 for name,score in totals.items()},indent=2))
        return
    if not args.token:
        parser.error('Set API_TOKEN or pass --token')
    run_id = uuid.uuid4().hex[:12]
    public, private = [], []
    for index, brief in enumerate(PROMPTS):
        response = requests.post(os.getenv('OLLAMA_HOST','http://localhost:11434')+'/api/generate',json={'model':os.getenv('CONTENT_MODEL','mistral:7b-instruct-q4_K_M'),'prompt':'Return JSON Meta ad with hook (125 chars), primary_text (280), headline (40), cta (LEARN MORE). Do not invent facts. '+brief,'format':'json','stream':False,'options':{'temperature':0.2,'num_predict':1800}},timeout=180)
        response.raise_for_status()
        baseline = json.loads(response.json()['response'])
        contextual = requests.post(args.api_url+'/content/generate',headers={'Authorization':'Bearer '+args.token},json={'content_type':'meta_ad','brief':brief},timeout=600)
        contextual.raise_for_status()
        contextual = contextual.json()
        outputs = [('baseline',baseline),('context',{k:contextual[k] for k in ['hook','primary_text','headline','cta']})]
        random.SystemRandom().shuffle(outputs)
        pair_id = f'{run_id}-{index+1:02d}'
        public.append({'id':pair_id,'brief':brief,**{label:value for label,(_,value) in zip(('A','B'),outputs)}})
        private.append({'id':pair_id,'labels':{label:name for label,(name,_) in zip(('A','B'),outputs)}})
        print(f'✅ Blinded pair {index+1}/20',flush=True)
    (ROOT/'evidence').mkdir(exist_ok=True)
    (ROOT/f'evidence/evaluation-{run_id}-blinded.json').write_text(json.dumps(public,indent=2))
    key_path = ROOT/f'evidence/evaluation-{run_id}-PRIVATE-key.json'
    key_path.write_text(json.dumps(private,indent=2))
    key_path.chmod(0o600)
    # PP1 evidence — screenshot this output
    print(f'✅ 20/20 pairs saved; run {run_id}. Give only blinded file to reviewers. Rate each A/B 1–5 for factuality, relevance, brand fit and clarity; use their mean.')

if __name__ == '__main__':
    main()
