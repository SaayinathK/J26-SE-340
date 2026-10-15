"""Exercise the evaluator against a local HTTP fixture; never loads model weights."""
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CLI = Path(__file__).resolve().parents[1] / 'training/evaluate_live.py'
FOOTER = 'To unsubscribe from these emails, reply STOP or click here.'


class EvaluatorTest(unittest.TestCase):
    def run_evaluation(self, installed=True, overlap=False):
        class Handler(BaseHTTPRequestHandler):
            calls = 0

            def log_message(self, *args):
                pass

            def reply(self, code, body):
                self.send_response(code)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(body).encode())

            def do_GET(self):
                self.reply(200, {'models': [{'name': 'email-ft:latest', 'digest': 'test-digest'}] if installed else []})

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                Handler.calls += 1
                if Handler.calls == 3:
                    return self.reply(503, {'error': 'Simulated unavailable model'})
                emails = [{'email_index': index + 1, 'send_at_days': day, 'subject': 'A useful introduction',
                           'body': 'Hello {{first_name}}, learn more at {{cta_link}}.\n\n' + FOOTER}
                          for index, day in enumerate([0, 3, 7])]
                if Handler.calls == 2:
                    emails[0]['body'] = 'Save 99% today!\n\n' + FOOTER
                self.reply(200, {'model': body['model'] + ':latest', 'done': True, 'response': json.dumps({'emails': emails})})

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                directory = Path(directory)
                data, train, output = directory / 'val.jsonl', directory / 'train.jsonl', directory / 'run'
                prompts = [f'Brand context:\nThere is no discount or promo code. Product {index} is available.\n\nYou are an email marketing specialist.\nCampaign goal: Introduce the product' for index in range(3)]
                data.write_text(''.join(json.dumps({'messages': [{'role': 'user', 'content': prompt}]}) + '\n' for prompt in prompts), encoding='utf-8')
                train.write_text(json.dumps({'messages': [{'role': 'user', 'content': prompts[0] if overlap else 'Independent training prompt'}]}) + '\n', encoding='utf-8')
                result = subprocess.run([sys.executable, str(CLI), '--model', 'email-ft', '--url', f'http://127.0.0.1:{server.server_port}',
                                         '--data', str(data), '--train-data', str(train), '--limit', '3', '--output-dir', str(output)],
                                        capture_output=True, text=True, timeout=15)
                summary = json.loads((output / 'summary.json').read_text()) if (output / 'summary.json').exists() else None
                rows = [json.loads(line) for line in (output / 'predictions.jsonl').read_text().splitlines()] if output.exists() else []
                return result, summary, rows, Handler.calls, output.exists()
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_fresh_outputs_failures_and_ungrounded_claims_are_counted(self):
        result, summary, rows, calls, _ = self.run_evaluation()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(calls, 3)
        self.assertEqual(summary['generation_failures'], 1)
        self.assertAlmostEqual(summary['reference_checks']['all_checks'], 1 / 3)
        self.assertAlmostEqual(summary['all_requirements_pass_rate'], 1 / 3)
        self.assertFalse(rows[1]['checks']['grounded'])
        self.assertIsNotNone(rows[2]['error'])
        self.assertFalse(any(rows[2]['checks'].values()))
        self.assertEqual(len({row['dataset_index'] for row in rows}), 3)
        self.assertTrue(all('prompt' in row and 'output' in row for row in rows))
        self.assertFalse(summary['postprocessing'])

    def test_missing_model_never_falls_back_or_runs_generation(self):
        result, summary, _, calls, exists = self.run_evaluation(installed=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('not installed', result.stderr)
        self.assertEqual(calls, 0)
        self.assertIsNone(summary)
        self.assertFalse(exists)

    def test_training_overlap_is_rejected_before_generation(self):
        result, _, _, calls, exists = self.run_evaluation(overlap=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('overlap', result.stderr)
        self.assertEqual(calls, 0)
        self.assertFalse(exists)


if __name__ == '__main__':
    unittest.main()
