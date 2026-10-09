'''Run 50 content-type classification requests against the service's exact prompt.'''
import json
import os
import subprocess
import requests
from ingest_kb import ROOT

PRODUCTS = ['a cooking class','a coaching program','a fitness workshop','a bookkeeping service','a design course','a gardening kit','a language class','a photography course','a local cafe','a consulting service']
TEMPLATES = {
 'meta_ad': 'Create a paid Facebook ad introducing {} to new customers.',
 'funnel_page': 'Write a landing page inviting visitors to sign up for {}.',
 'email': 'Write an email asking existing subscribers to buy {}.',
 'social_post': 'Create an organic Instagram post introducing {}.',
 'vsl': 'Write a video sales letter selling {}.'
}

def main():
    prompt = subprocess.check_output(['node','-e',"process.stdout.write(require('./src/services/contextEngine').CLASSIFIER_PROMPT)"],cwd=ROOT,text=True)
    lines, correct = [], 0
    for kind, template in TEMPLATES.items():
        for product in PRODUCTS:
            brief = template.format(product)
            try:
                response = requests.post(os.getenv('OLLAMA_HOST','http://localhost:11434')+'/api/generate',json={'model':os.getenv('CONTEXT_MODEL','phi3:mini'),'prompt':prompt+json.dumps(brief),'stream':False,'format':'json','options':{'temperature':0.2,'num_predict':150}},timeout=180)
                response.raise_for_status()
                result = json.loads(response.json()['response'])
                actual = result.get('content_type')
            except (requests.RequestException, ValueError, KeyError) as error:
                actual = f'ERROR: {error}'
            passed = actual == kind
            correct += int(passed)
            line = f'{"✅" if passed else "❌"} expected={kind} actual={actual}: {brief}'
            lines.append(line)
            print(line,flush=True)
    # PP1 evidence — screenshot this output
    summary = f'{correct}/50 = {correct/50:.0%}; target 43/50: {"PASS" if correct >= 43 else "FAIL"}'
    print(summary)
    (ROOT/'evidence').mkdir(exist_ok=True)
    (ROOT/'evidence/c1-02-accuracy.txt').write_text('\n'.join(lines+[summary])+'\n')
    return 0 if correct >= 43 else 1

if __name__ == '__main__':
    raise SystemExit(main())
