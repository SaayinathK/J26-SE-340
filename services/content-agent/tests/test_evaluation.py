import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import evaluation

AD = {'hook':'Plan today', 'primary_text':'Learn campaign planning.', 'headline':'Get started', 'cta':'LEARN MORE'}

def response(status, body):
    result = Mock(status_code=status, ok=status < 400)
    result.json.return_value = body
    return result

class EvaluationTests(unittest.TestCase):
    def test_retries_502_and_reports_detail(self):
        with patch.object(evaluation.requests, 'post', side_effect=[response(502, {'error':'headline exceeds 40 characters'}), response(200, AD)]) as post, patch.object(evaluation.time, 'sleep'), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(evaluation.post_json('http://test'), AD)
            self.assertEqual(post.call_count, 2)
            self.assertIn('headline exceeds 40', output.getvalue())

    def test_does_not_retry_quota_or_ambiguous_timeout(self):
        for outcome in [response(429, {'error':'Generation limit reached'}), evaluation.requests.Timeout()]:
            with patch.object(evaluation.requests, 'post', side_effect=[outcome]) as post:
                with self.assertRaises(evaluation.EvaluationError):
                    evaluation.post_json('http://test')
                self.assertEqual(post.call_count, 1)

    def test_pair_17_failure_preserves_and_resumes_without_repeating_baseline(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(evaluation, 'ROOT', Path(directory)), contextlib.redirect_stdout(io.StringIO()):
            contextual_count = 0
            def generate(url, **kwargs):
                nonlocal contextual_count
                if url.endswith('/api/generate'):
                    return {'response':json.dumps(AD)}
                contextual_count += 1
                if contextual_count == 17:
                    raise evaluation.EvaluationError('HTTP 502: invalid model output')
                return AD
            with patch.object(sys, 'argv', ['evaluation.py','--token','secret-evaluation-token']), patch.object(evaluation, 'post_json', side_effect=generate):
                self.assertEqual(evaluation.main(), 1)
            checkpoint = next(Path(directory).glob('evidence/*-PRIVATE-checkpoint.json'))
            state = json.loads(checkpoint.read_text())
            self.assertEqual(len(state['public']), 16)
            self.assertEqual(state['pending_baseline'], AD)
            self.assertNotIn('secret-evaluation-token', checkpoint.read_text())
            calls = []
            def resume(url, **kwargs):
                calls.append(url)
                return {'response':json.dumps(AD)} if url.endswith('/api/generate') else AD
            with patch.object(sys, 'argv', ['evaluation.py','--token','secret-evaluation-token','--resume',str(checkpoint)]), patch.object(evaluation, 'post_json', side_effect=resume):
                self.assertEqual(evaluation.main(), 0)
            self.assertTrue(calls[0].endswith('/content/generate'))
            self.assertEqual(len(calls), 7)
            state = json.loads(checkpoint.read_text())
            self.assertEqual(len(state['public']), 20)
            self.assertEqual(len({r['id'] for r in state['public']}), 20)
            self.assertEqual(len(state['failures']), 1)

if __name__ == '__main__':
    unittest.main()
