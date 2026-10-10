'''Generate 20 blinded baseline/context pairs; score later with a separate key.'''
import argparse
import json
import os
import random
import uuid
import time
import tempfile
from pathlib import Path
import requests
from ingest_kb import ROOT

PROMPTS = [f'Write a Meta ad for the Campaign Foundations workshop focusing on {focus}. Invite readers to learn more.' for focus in [
 'clear offers','audience research','campaign planning','message testing','founder confidence','plain language','practical worksheets','first-time marketers','independent consultants','limited time','avoiding vague copy','defining a call to action','reviewing a message','learning through exercises','small-business needs','one campaign at a time','offer clarity','actionable learning','campaign foundations','a repeatable planning process']]

class EvaluationError(Exception):
    pass


def save_json(path, value):
    """Replace atomically, keeping checkpoints and answer keys private."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def post_json(url, *, attempts=3, **kwargs):
    for attempt in range(1, attempts + 1):
        try:
            response = requests.post(url, **kwargs)
        except requests.RequestException as error:
            # A lost response can occur after persistence; do not blindly duplicate a generation.
            raise EvaluationError(f'Connection failed ({type(error).__name__}). Check server/history before resuming; the request may have completed.') from None
        if response.ok:
            try:
                return response.json()
            except ValueError:
                raise EvaluationError('Server returned invalid JSON') from None
        try:
            body = response.json()
            detail = body.get('error', body) if isinstance(body, dict) else body
        except ValueError:
            detail = response.text[:500]
        message = f'HTTP {response.status_code}: {detail}'
        # The service returns 502 before generation persistence (model failure/validation).
        if response.status_code != 502 or attempt == attempts:
            raise EvaluationError(message)
        print(f'⚠ {message}; retry {attempt + 1}/{attempts}', flush=True)
        time.sleep(min(2 ** attempt, 8))
    raise EvaluationError('Request attempts exhausted')


def publish(state):
    run_id = state['run_id']
    save_json(ROOT / f'evidence/evaluation-{run_id}-blinded.json', state['public'])
    save_json(ROOT / f'evidence/evaluation-{run_id}-PRIVATE-key.json', state['private'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token',default=os.getenv('API_TOKEN'))
    parser.add_argument('--api-url',default='http://localhost:5001')
    parser.add_argument('--score',type=str,help='JSON ratings array with id, A and B scores from 1 to 5')
    parser.add_argument('--key',type=str,help='Private evaluation key file for scoring')
    parser.add_argument('--resume', type=Path, help='Resume a PRIVATE-checkpoint.json file')
    parser.add_argument('--attempts', type=int, default=3, choices=range(1, 6), help='Maximum attempts on explicit HTTP 502 failures')
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
    checkpoint = args.resume
    if checkpoint:
        state = json.loads(checkpoint.read_text())
        if state.get('prompts') != PROMPTS or len(state['public']) != len(state['private']):
            parser.error('Checkpoint does not match this evaluation')
    else:
        run_id = uuid.uuid4().hex[:12]
        checkpoint = ROOT / f'evidence/evaluation-{run_id}-PRIVATE-checkpoint.json'
        state = {'run_id':run_id, 'prompts':PROMPTS, 'public':[], 'private':[], 'pending_baseline':None, 'failures':[]}
        save_json(checkpoint, state)
    print(f'Checkpoint: {checkpoint}', flush=True)
    try:
        for index in range(len(state['public']), len(PROMPTS)):
            brief = PROMPTS[index]
            if state['pending_baseline'] is None:
                response = post_json(os.getenv('OLLAMA_HOST','http://localhost:11434')+'/api/generate', attempts=args.attempts,
                    json={'model':os.getenv('CONTENT_MODEL','mistral:7b-instruct-q4_K_M'),'prompt':'Return JSON Meta ad with hook (125 chars), primary_text (280), headline (40), cta (LEARN MORE). Do not invent facts. '+brief,'format':'json','stream':False,'options':{'temperature':0.2,'num_predict':1800}}, timeout=180)
                state['pending_baseline'] = json.loads(response['response'])
                save_json(checkpoint, state)
            contextual = post_json(args.api_url.rstrip('/')+'/content/generate', attempts=args.attempts,
                headers={'Authorization':'Bearer '+args.token},json={'content_type':'meta_ad','brief':brief},timeout=600)
            outputs = [('baseline',state['pending_baseline']),('context',{k:contextual[k] for k in ['hook','primary_text','headline','cta']})]
            random.SystemRandom().shuffle(outputs)
            pair_id = f"{state['run_id']}-{index+1:02d}"
            state['public'].append({'id':pair_id,'brief':brief,**{label:value for label,(_,value) in zip(('A','B'),outputs)}})
            state['private'].append({'id':pair_id,'labels':{label:name for label,(name,_) in zip(('A','B'),outputs)}})
            state['pending_baseline'] = None
            save_json(checkpoint, state)
            publish(state)
            print(f'✅ Blinded pair {index+1}/20 saved',flush=True)
    except (EvaluationError, ValueError, KeyError, KeyboardInterrupt) as error:
        message = str(error) or 'Interrupted'
        state['failures'].append({'pair':len(state['public'])+1,'error':message})
        save_json(checkpoint, state)
        publish(state)
        print(f"❌ Pair {len(state['public'])+1} stopped: {message}", flush=True)
        print(f"Saved {len(state['public'])}/20 completed pairs. Resume with:")
        import shlex
        print(f'.venv/bin/python scripts/evaluation.py --resume {shlex.quote(str(checkpoint))} --api-url {shlex.quote(args.api_url)} --token "$API_TOKEN"')
        return 1
    publish(state)
    # PP1 evidence — screenshot this output
    print(f"✅ 20/20 pairs saved; run {state['run_id']}. Give only blinded file to reviewers. Keep checkpoint and key private.")
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
