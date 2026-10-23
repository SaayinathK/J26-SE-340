"""Tenant-scoped QLoRA worker. Run in a connected Colab GPU runtime, never the web server.

Uses real Transformers/PEFT training and the local Ollama CLI. No test/mock training mode.
The server owns dataset eligibility, leases, evaluation decisions and tenant model selection.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        # Do not forward the worker bearer credential to another origin.
        return None


class Connection:
    def __init__(self, origin, token=None):
        address = urlsplit(origin)
        if address.scheme not in ('https', 'http') or not address.netloc or address.username or address.password or address.path not in ('', '/') or address.query or address.fragment:
            raise ValueError('Use an HTTP(S) root origin without credentials, path or query.')
        if address.scheme == 'http' and address.hostname not in ('localhost', '127.0.0.1', '::1'):
            raise ValueError('Public training connections must use HTTPS.')
        self.origin, self.token = origin.rstrip('/'), token
        self.opener = build_opener(NoRedirect())

    def request(self, path, body=None, timeout=30):
        headers = {'Accept': 'application/json'}
        if self.token:
            headers['Authorization'] = 'Bearer ' + self.token
        data = None if body is None else json.dumps(body).encode()
        if data is not None:
            headers['Content-Type'] = 'application/json'
        request = Request(self.origin + path, data=data, headers=headers)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                return json.load(response)
        except HTTPError as error:
            # Never include tokens, request headers or response HTML in logs.
            message = 'Training connection rejected the request (HTTP %s).' % error.code
            try:
                payload = json.loads(error.read(2048))
                if isinstance(payload.get('error'), str):
                    message = payload['error'][:500]
            except (ValueError, UnicodeError):
                pass
            raise RuntimeError(message) from None


class Lease:
    def __init__(self, api, job):
        self.api, self.job = api, job
        self.stage, self.stopped, self.lost = 'Preparing', threading.Event(), threading.Event()
        self.thread = threading.Thread(target=self.loop, daemon=True)

    def update(self, stage):
        self.stage = stage
        self.check()
        self.api.request('/api/training-worker/jobs/' + self.job['id'] + '/heartbeat', {'lease': self.job['lease'], 'stage': stage})

    def loop(self):
        failures = 0
        while not self.stopped.wait(30):
            try:
                self.update(self.stage)
                failures = 0
            except (OSError, ValueError, RuntimeError):
                failures += 1
                if failures >= 3:
                    self.lost.set()
                    return

    def check(self):
        if self.lost.is_set():
            raise RuntimeError('Worker lease lost. Training stopped; reconnect before retrying.')

    def __enter__(self):
        self.update('Preparing')
        self.thread.start()
        return self

    def __exit__(self, *_args):
        self.stopped.set()
        self.thread.join(timeout=35)


def safe_job_directory(root, job):
    import uuid
    tenant, identifier = str(uuid.UUID(job['tenant_id'])), str(uuid.UUID(job['id']))
    root = root.resolve()
    directory = root / tenant / identifier
    if not directory.resolve().is_relative_to(root):
        raise ValueError('Invalid job directory.')
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / 'dataset-hash.txt'
    if manifest.exists() and manifest.read_text().strip() != job['dataset_hash']:
        raise ValueError('This job directory belongs to a different dataset.')
    manifest.write_text(job['dataset_hash'] + '\n')
    return directory


def outputs(ollama, model, cases, lease):
    result = []
    for index, case in enumerate(cases):
        lease.check()
        response = ollama.request('/api/generate', {'model': model, 'prompt': case['prompt'], 'stream': False,
            'options': {'temperature': 0, 'seed': 42, 'num_predict': 1800, 'num_ctx': 4096}}, timeout=180)
        value = response.get('response')
        if response.get('done') is not True or not isinstance(value, str) or not value or len(value) > 16000:
            raise ValueError('Model returned an incomplete or oversized evaluation output.')
        result.append(value)  # Raw output: never repair JSON, footer or claims before evaluation.
        print('%s: %s/%s evaluation cases' % (lease.stage, index + 1, len(cases)), flush=True)
    return result


def preflight(ollama):
    if not shutil.which('ollama'):
        raise RuntimeError('Install the local Ollama CLI in this Colab runtime before connecting the worker.')
    if urlsplit(ollama.origin).hostname not in ('localhost', '127.0.0.1', '::1'):
        raise ValueError('Ollama must run in this same Colab runtime so it can read the adapter files.')
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError('Select a Colab GPU runtime. CUDA training is required.')
    ollama.request('/api/tags')
    version = ollama.request('/api/version').get('version')
    if version != '0.12.3':
        raise RuntimeError('This adapter import path requires the project-pinned Ollama 0.12.3 runtime, server and CLI.')


def train_adapter(job, directory, lease, initial_adapter=None):
    """Actual QLoRA: answer-only loss, frozen quantized base, trainable LoRA weights."""
    import gc
    import inspect
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig
    from transformers import Trainer, TrainerCallback, TrainingArguments, DataCollatorForSeq2Seq
    from transformers.trainer_utils import get_last_checkpoint
    from peft import LoraConfig, PeftModel, get_peft_model, prepare_model_for_kbit_training
    adapter = directory / 'adapter'
    if (adapter / 'adapter_model.safetensors').is_file():
        print('Reusing this job’s saved adapter; dataset manifest matched.', flush=True)
        return adapter
    tokenizer = AutoTokenizer.from_pretrained(job['base_hf_model'])
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.unk_token or tokenizer.eos_token
    tokenizer.padding_side = 'right'
    config = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type='nf4', bnb_4bit_compute_dtype=torch.float16, bnb_4bit_use_double_quant=True)
    model = AutoModelForCausalLM.from_pretrained(job['base_hf_model'], quantization_config=config, device_map={'': 0}, torch_dtype=torch.float32)
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True, gradient_checkpointing_kwargs={'use_reentrant': False})
    # Continue the workspace's previous adapter only when its tenant-owned Drive artifact exists.
    prior = None
    prefix = 'c4ft-' + job['tenant_id'] + '-'
    if job['baseline_model'].startswith(prefix):
        import uuid
        previous_id = str(uuid.UUID(job['baseline_model'][len(prefix):]))
        prior = directory.parent / previous_id / 'adapter'
        if not (prior / 'adapter_model.safetensors').is_file():
            raise RuntimeError('The active tenant adapter is missing from Drive. Restore it before continuing fine-tuning.')
    elif initial_adapter:
        prior = Path(initial_adapter).resolve()
        if not (prior / 'adapter_model.safetensors').is_file():
            raise RuntimeError('The configured starting adapter is missing from Drive.')
    elif job['baseline_model'] != job['ollama_base']:
        raise RuntimeError('Provide --initial-adapter for the existing fine-tuned default model. A fresh base must not silently replace learned weights.')
    if prior:
        adapter_config = json.loads((prior / 'adapter_config.json').read_text())
        if adapter_config.get('base_model_name_or_path', '').lower() not in ('unsloth/mistral-7b-instruct-v0.3', 'mistralai/mistral-7b-instruct-v0.3'):
            raise RuntimeError('The starting adapter must use the matching Mistral 7B Instruct v0.3 base.')
    model = PeftModel.from_pretrained(model, str(prior), is_trainable=True) if prior else get_peft_model(model, LoraConfig(
        r=16, lora_alpha=32, lora_dropout=.05, bias='none', task_type='CAUSAL_LM',
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj']))
    model.config.use_cache = False

    def tokenize(example):
        messages = example['messages']
        prefix_text = tokenizer.apply_chat_template(messages[:1], tokenize=False, add_generation_prompt=True)
        full_text = tokenizer.apply_chat_template(messages, tokenize=False)
        prefix_ids = tokenizer(prefix_text, add_special_tokens=False)['input_ids']
        encoded = tokenizer(full_text, add_special_tokens=False, truncation=False)
        if len(encoded['input_ids']) > 4096:
            raise ValueError('A reviewed example exceeds the 4096-token training limit; shorten its source context.')
        if encoded['input_ids'][:len(prefix_ids)] != prefix_ids:
            raise ValueError('The tokenizer chat template does not preserve the answer-only boundary.')
        encoded['labels'] = [-100] * len(prefix_ids) + encoded['input_ids'][len(prefix_ids):]
        return encoded

    training = [tokenize(example) for example in job['dataset']['training']]
    validation = [tokenize(example) for example in job['dataset']['validation']]
    class LeaseCallback(TrainerCallback):
        def on_step_begin(self, *_args, **_kwargs):
            lease.check()
    options = dict(output_dir=str(directory / 'checkpoints'), num_train_epochs=2, learning_rate=.0002,
        per_device_train_batch_size=1, per_device_eval_batch_size=1, gradient_accumulation_steps=8,
        lr_scheduler_type='cosine', warmup_ratio=.05, logging_steps=1, save_strategy='steps', save_steps=10,
        save_total_limit=2, fp16=True, optim='paged_adamw_8bit', report_to='none', seed=42)
    parameters = inspect.signature(TrainingArguments.__init__).parameters
    options['eval_strategy' if 'eval_strategy' in parameters else 'evaluation_strategy'] = 'epoch'
    trainer = Trainer(model=model, args=TrainingArguments(**options), train_dataset=training, eval_dataset=validation,
        data_collator=DataCollatorForSeq2Seq(tokenizer, padding=True, label_pad_token_id=-100), callbacks=[LeaseCallback()])
    last = get_last_checkpoint(str(directory / 'checkpoints')) if (directory / 'checkpoints').is_dir() else None
    try:
        trainer.train(resume_from_checkpoint=last)
        lease.check()
        model.save_pretrained(adapter, safe_serialization=True)
        tokenizer.save_pretrained(adapter)
        (directory / 'training-log.json').write_text(json.dumps(trainer.state.log_history, indent=2))
    finally:
        del trainer, model
        gc.collect()
        torch.cuda.empty_cache()
    return adapter


def run_job(api, ollama, job, root, initial_adapter=None):
    if job['base_hf_model'] != 'unsloth/mistral-7b-instruct-v0.3' or job['ollama_base'] != 'mistral:7b-instruct-v0.3-q4_K_M':
        raise ValueError('Unsupported base model; review runtime compatibility before changing it.')
    if job['candidate_model'] != 'c4ft-' + job['tenant_id'] + '-' + job['id'] or not re.fullmatch(r'[a-zA-Z0-9_./:-]+', job['baseline_model']):
        raise ValueError('Invalid assigned model name.')
    directory = safe_job_directory(root, job)
    with Lease(api, job) as lease:
        preflight(ollama)
        installed = {model['name'].removesuffix(':latest') for model in ollama.request('/api/tags')['models']}
        for required in (job['baseline_model'], job['ollama_base']):
            if required.removesuffix(':latest') not in installed:
                raise RuntimeError('Required model is not installed in this Colab Ollama runtime: ' + required)
        cases = job['dataset']['validation'] + job['dataset']['regression']
        lease.update('Evaluating baseline')
        baseline = outputs(ollama, job['baseline_model'], cases, lease)
        (directory / 'baseline-outputs.json').write_text(json.dumps(baseline))
        # All app AI calls are paused by the server's running-job lease; unload before CUDA training.
        for model in ollama.request('/api/ps').get('models', []):
            ollama.request('/api/generate', {'model': model['name'], 'keep_alive': 0}, timeout=180)
        lease.update('Training QLoRA')
        adapter = train_adapter(job, directory, lease, initial_adapter)
        lease.update('Registering candidate')
        recipe = directory / 'Modelfile'
        recipe.write_text('FROM ' + job['ollama_base'] + '\nADAPTER ' + str(adapter.resolve()) + '\nPARAMETER num_ctx 4096\n')
        environment = {**os.environ, 'OLLAMA_HOST': ollama.origin}
        # Argument arrays only. Model names and paths are never executed as shell text.
        with (directory / 'ollama-registration.log').open('w') as log:
            process = subprocess.Popen(['ollama', 'create', job['candidate_model'], '-f', str(recipe)], env=environment, stdout=log, stderr=subprocess.STDOUT)
            try:
                while process.poll() is None:
                    lease.check()
                    time.sleep(1)
                if process.returncode:
                    raise RuntimeError('Ollama adapter registration failed. Inspect the job registration log in Drive; active model unchanged.')
            finally:
                if process.poll() is None:
                    process.terminate()
        lease.update('Evaluating candidate')
        candidate = outputs(ollama, job['candidate_model'], cases, lease)
        weights = adapter / 'adapter_model.safetensors'
        checksum = hashlib.sha256(weights.read_bytes()).hexdigest()
        report = {'lease': job['lease'], 'candidate_outputs': candidate, 'baseline_outputs': baseline,
                  'artifact': {'model': job['candidate_model'], 'adapter_sha256': checksum, 'training_mode': 'qlora'}}
        result = api.request('/api/training-worker/jobs/' + job['id'] + '/complete', report, timeout=90)
        # Store no bearer token or job lease in the persistent evaluation report.
        (directory / 'evaluation.json').write_text(json.dumps({'candidate_outputs': candidate, 'baseline_outputs': baseline, 'decision': result}, indent=2))
        print('Job %s: %s' % (job['id'], result['status']), flush=True)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-url', required=True, help='Public HTTPS frontend/gateway origin')
    parser.add_argument('--ollama-url', default='http://127.0.0.1:11434')
    parser.add_argument('--work-dir', type=Path, default=Path('/content/drive/MyDrive/ciftron-qlora'))
    parser.add_argument('--initial-adapter', type=Path, help='Drive adapter used to build the configured default model; required if the default is already fine-tuned')
    parser.add_argument('--poll-seconds', type=int, default=60)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--check', action='store_true', help='Check the local GPU/runtime without claiming jobs')
    args = parser.parse_args()
    token = os.environ.get('C4_FT_WORKER_TOKEN')
    if not token:
        import getpass
        token = getpass.getpass('Colab worker token (hidden): ')
    api, ollama = Connection(args.api_url, token), Connection(args.ollama_url)
    if args.check:
        preflight(ollama)
        print('CUDA and local Ollama are available. No job was claimed or trained.')
        return
    if args.poll_seconds < 15:
        parser.error('Poll interval must be at least 15 seconds.')
    while True:
        job = api.request('/api/training-worker/claim', {})['job']
        if job:
            try:
                run_job(api, ollama, job, args.work_dir, args.initial_adapter)
            except KeyboardInterrupt:
                raise
            except Exception as error:
                # Exception messages from libraries can contain URLs or environment values.
                # Keep the server failure record generic; inspect Colab/Drive logs locally.
                try:
                    api.request('/api/training-worker/jobs/' + job['id'] + '/fail', {'lease': job['lease'], 'error': 'Colab worker failed during training or evaluation. Inspect this job’s Colab/Drive logs.'})
                except (OSError, ValueError, RuntimeError):
                    pass
                print('Job failed (%s). Active model preserved; inspect the Colab traceback.' % type(error).__name__, flush=True)
                raise
        elif args.once:
            print('No eligible queued job. Training consent, reviewed examples and queue settings are controlled in Learning Center.')
        if args.once:
            return
        time.sleep(args.poll_seconds)


if __name__ == '__main__':
    main()
