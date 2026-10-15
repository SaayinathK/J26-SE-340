"""Evaluate fresh Ollama generations on held-out email prompts, without training."""
import argparse
import hashlib
import json
import platform
import random
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from verify_artifacts import check, CHECKS
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from shared.eval_utils import pass_rates

ROOT = Path(__file__).resolve().parents[3]
FOOTER = 'To unsubscribe from these emails, reply STOP or click here.'


def request_json(origin, route, payload=None, timeout=5):
    request = Request(origin + route, data=None if payload is None else json.dumps(payload).encode(),
                      headers={'Content-Type': 'application/json'}, method='GET' if payload is None else 'POST')
    with urlopen(request, timeout=timeout) as response:
        return json.load(response)


def prompts(path):
    rows = [json.loads(line) for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    result = []
    for row in rows:
        messages = row.get('messages', [])
        if not messages or messages[0].get('role') != 'user' or not isinstance(messages[0].get('content'), str) or not messages[0]['content'].strip():
            raise ValueError('Every dataset row needs a nonempty first user message')
        result.append(messages[0]['content'])
    if not result:
        raise ValueError('Dataset is empty')
    return result


def strict_checks(output):
    result = {'strict_json': False, 'email_indices': False, 'exact_footer_all': False}
    try:
        body = json.loads(output)
        result['strict_json'] = isinstance(body, dict) and isinstance(body.get('emails'), list)
        emails = body['emails']
        if len(emails) != 3 or not all(isinstance(email, dict) for email in emails):
            return result
        result['email_indices'] = [email.get('email_index') for email in emails] == [1, 2, 3]
        result['exact_footer_all'] = all(isinstance(email.get('body'), str) and email['body'].rstrip().endswith(FOOTER) for email in emails)
    except (ValueError, KeyError, TypeError):
        pass
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True, help='Exact installed Ollama model tag; never falls back to the base model')
    parser.add_argument('--url', default='http://127.0.0.1:11435')
    parser.add_argument('--data', type=Path, default=ROOT / 'ml/email-agent/data/processed/val.jsonl')
    parser.add_argument('--train-data', type=Path, default=ROOT / 'ml/email-agent/data/processed/train.jsonl')
    parser.add_argument('--limit', type=int, default=25)
    parser.add_argument('--seed', type=int, default=42)
    parser.add_argument('--timeout', type=float, default=150, help='Seconds per generation')
    parser.add_argument('--num-predict', type=int, default=1800)
    parser.add_argument('--num-ctx', type=int, default=4096, help='Context window; use identical settings for base and adapter comparisons')
    parser.add_argument('--num-thread', type=int, help='Optional CPU worker count')
    parser.add_argument('--use-mmap', action='store_true', help='Request memory-mapped weights to reduce CPU loading memory')
    parser.add_argument('--output-dir', type=Path, required=True, help='New directory; existing reports are never overwritten')
    args = parser.parse_args()
    address = urlsplit(args.url)
    if address.scheme not in ('http', 'https') or not address.netloc or address.username or address.password or address.path not in ('', '/') or address.query or address.fragment:
        parser.error('--url must be an HTTP(S) origin without credentials, path or query')
    if args.limit < 1 or args.timeout <= 0 or args.num_predict < 1 or args.num_ctx < 1 or args.num_thread is not None and args.num_thread < 1:
        parser.error('Limit, timeout, token/context counts and CPU worker count must be positive')
    origin = args.url.rstrip('/')
    try:
        validation = prompts(args.data)
        training = set(value.strip() for value in prompts(args.train_data))
        if any(value.strip() in training for value in validation):
            parser.error('Validation prompts overlap training prompts; use an independent held-out dataset')
        if args.limit > len(validation):
            parser.error(f'Only {len(validation)} held-out prompts are available')
        tags = request_json(origin, '/api/tags')
        if not isinstance(tags, dict) or not isinstance(tags.get('models'), list):
            raise ValueError('The model server returned an invalid installed-model list')
        installed = tags['models']
        selected = next((model for model in installed if model.get('name') in (args.model, args.model + ':latest')), None)
        if selected is None:
            parser.error(f'Model {args.model!r} is not installed.\nFor the saved c4-email-ft adapter, run:\n  powershell -NoProfile -File ml/email-agent/serving/register-finetuned.ps1\nNo generation was run.')
        args.output_dir.mkdir(parents=True, exist_ok=False)
    except (OSError, ValueError, URLError) as error:
        parser.error(str(error))

    indices = random.Random(args.seed).sample(range(len(validation)), args.limit)
    rows = []
    options = {'temperature': 0, 'seed': args.seed, 'num_ctx': args.num_ctx, 'num_predict': args.num_predict}
    if args.num_thread is not None:
        options['num_thread'] = args.num_thread
    if args.use_mmap:
        options['use_mmap'] = True
    output_file = args.output_dir / 'predictions.jsonl'
    with output_file.open('x', encoding='utf-8') as handle:
        for number, index in enumerate(indices, 1):
            prompt = validation[index]
            started = time.monotonic()
            output, failure, response_model, done_reason = '', None, None, None
            try:
                response = request_json(origin, '/api/generate', {
                    'model': args.model, 'prompt': prompt, 'stream': False, 'options': options,
                    # Raw generations: no JSON-constrained decoding or footer repair.
                }, timeout=args.timeout)
                if not isinstance(response, dict):
                    raise ValueError('The model server returned an invalid generation response')
                output = response.get('response', '')
                response_model = response.get('model')
                done_reason = response.get('done_reason')
                if response.get('error') or response.get('done') is not True or not isinstance(output, str) or not output.strip():
                    raise ValueError(response.get('error') or 'Generation was empty or incomplete')
                if response_model not in (args.model, args.model + ':latest'):
                    raise ValueError('The response model does not match the requested model')
            except (OSError, ValueError, URLError) as error:
                failure = f'{type(error).__name__}: {error}'
                if not isinstance(output, str):
                    output = ''
            reference = dict.fromkeys(CHECKS, False) if failure else check(prompt, output)
            strict = dict.fromkeys(strict_checks('').keys(), False) if failure else strict_checks(output)
            row = {'dataset_index': index, 'prompt': prompt, 'output': output, 'error': failure,
                   'response_model': response_model, 'done_reason': done_reason,
                   'seconds': round(time.monotonic() - started, 3), 'checks': reference, 'strict_checks': strict}
            rows.append(row)
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
            handle.flush()
            print(f'{number}/{args.limit}: ' + ('generation failed' if failure else 'pass' if all(reference.values()) and all(strict.values()) else 'check failed'), flush=True)

    summary = {'mode': 'fresh_ollama_generations', 'timestamp_utc': datetime.now(timezone.utc).isoformat(),
               'model': args.model, 'installed_model': selected.get('name'), 'ollama_digest': selected.get('digest'),
               'dataset': str(args.data), 'dataset_sha256': hashlib.sha256(args.data.read_bytes()).hexdigest(),
               'training_overlap': False, 'selected_indices': indices, 'seed': args.seed, 'python': platform.python_version(),
               'generation_options': options, 'json_constrained_decoding': False, 'postprocessing': False,
               'reference_checks': pass_rates(row['checks'] for row in rows),
               'strict_checks': pass_rates(row['strict_checks'] for row in rows),
               'all_requirements_pass_rate': sum(all(row['checks'].values()) and all(row['strict_checks'].values()) for row in rows) / len(rows),
               'generation_failures': sum(row['error'] is not None for row in rows),
               'mean_seconds': sum(row['seconds'] for row in rows) / len(rows),
               'limitations': ['Grounding checks cover numbers and promo codes, not all factual claims.',
                               'Human review is required for relevance, tone and semantic factuality.',
                               'An Ollama tag/digest identifies the served artifact but does not attest its adapter/base lineage.',
                               'These results are not directly interchangeable with historical notebook results: prompt selection and runtime differ.']}
    (args.output_dir / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, indent=2))
    return 1 if summary['generation_failures'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
