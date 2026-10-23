"""CPU-only worker contracts: no actual GPU training is performed."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SOURCE = Path(__file__).resolve().parents[1] / 'training' / 'colab_worker.py'
spec = importlib.util.spec_from_file_location('colab_worker', SOURCE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerContract(unittest.TestCase):
    def job(self):
        return {'tenant_id': '12345678-1234-4234-8234-123456789012', 'id': '98765432-1234-4234-8234-123456789012', 'dataset_hash': 'a' * 64}

    def test_requires_https_public_origin_without_credentials(self):
        for address in ('http://example.test', 'https://user:pass@example.test', 'https://example.test/api', 'https://example.test/?token=abc', 'file:///tmp'):
            with self.subTest(address=address), self.assertRaises(ValueError):
                worker.Connection(address)
        self.assertEqual(worker.Connection('https://example.test/').origin, 'https://example.test')

    def test_bearer_request_refuses_redirects(self):
        seen = []
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                seen.append((self.path, self.headers.get('Authorization')))
                self.send_response(302 if self.path == '/redirect' else 200)
                self.send_header('Location', '/credential-leak')
                self.end_headers()
                self.wfile.write(b'{"job":null}')
            def log_message(self, *_args): pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = worker.Connection('http://127.0.0.1:' + str(server.server_port), 'fixture-token')
            self.assertEqual(connection.request('/claim', {}), {'job': None})
            with self.assertRaisesRegex(RuntimeError, 'HTTP 302'):
                connection.request('/redirect', {})
            self.assertEqual(seen, [('/claim', 'Bearer fixture-token'), ('/redirect', 'Bearer fixture-token')])
        finally:
            server.shutdown(); server.server_close(); thread.join()

    def test_scoped_paths_and_immutable_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root, job = Path(directory), self.job()
            destination = worker.safe_job_directory(root, job)
            self.assertEqual(destination, root / job['tenant_id'] / job['id'])
            self.assertEqual(worker.safe_job_directory(root, job), destination)
            job['dataset_hash'] = 'b' * 64
            with self.assertRaisesRegex(ValueError, 'different dataset'):
                worker.safe_job_directory(root, job)
            job['tenant_id'] = '../escape'
            with self.assertRaises(ValueError): worker.safe_job_directory(root, job)

    def test_raw_outputs_are_never_repaired(self):
        lease, ollama = Mock(stage='Evaluating candidate'), Mock()
        for raw in ('{"emails":[{"body":"No footer"}]}', 'not JSON'):
            ollama.request.return_value = {'done': True, 'response': raw}
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(worker.outputs(ollama, 'fixture-model', [{'prompt': 'Prompt'}], lease), [raw])
        self.assertEqual(ollama.request.call_args.args[1]['options']['temperature'], 0)

    def test_incomplete_output_is_rejected(self):
        ollama = Mock()
        ollama.request.return_value = {'done': False, 'response': 'partial'}
        with self.assertRaises(ValueError): worker.outputs(ollama, 'fixture-model', [{'prompt': 'Prompt'}], Mock())

    def test_lost_lease_stops_model_calls(self):
        lease = worker.Lease(Mock(), {**self.job(), 'lease': 'b' * 64})
        lease.lost.set()
        ollama = Mock()
        with self.assertRaisesRegex(RuntimeError, 'lease lost'):
            worker.outputs(ollama, 'fixture-model', [{'prompt': 'Prompt'}], lease)
        ollama.request.assert_not_called()

    def test_base_and_model_recipe_validation(self):
        job = {**self.job(), 'base_hf_model': 'unreviewed/model', 'ollama_base': 'wrong-base'}
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            worker.run_job(Mock(), Mock(), job, Path(directory))
        job.update(base_hf_model='unsloth/mistral-7b-instruct-v0.3', ollama_base='mistral:7b-instruct-v0.3-q4_K_M', candidate_model='model\nFROM wrong', baseline_model='base')
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            worker.run_job(Mock(), Mock(), job, Path(directory))

    def test_version_check_without_real_cuda(self):
        ollama, torch = Mock(origin='http://127.0.0.1:11434'), Mock()
        ollama.request.return_value = {'version': 'different'}
        torch.cuda.is_available.return_value = True
        with patch.dict('sys.modules', {'torch': torch}), patch.object(worker.shutil, 'which', return_value='/usr/bin/ollama'):
            with self.assertRaisesRegex(RuntimeError, '0.12.3'): worker.preflight(ollama)

    def test_notebook_is_clean_and_compiles(self):
        data = json.loads((SOURCE.parents[1] / 'notebooks' / 'c4_continuous_qlora_colab.ipynb').read_text(encoding='utf-8'))
        for cell in data['cells']:
            if cell['cell_type'] == 'code':
                self.assertEqual(cell['outputs'], [])
                self.assertIsNone(cell['execution_count'])
                compile(''.join(cell['source']), cell['id'], 'exec')


if __name__ == '__main__': unittest.main()
