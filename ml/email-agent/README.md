# Email Agent training and serving

The saved training workflow is QLoRA on Mistral 7B Instruct v0.3, using the Email Marketing Campaign CTR CSV to produce grounded three-email sequences. The dataset's CTR column is synthetic and is not model accuracy.

| Asset | Location |
| --- | --- |
| Original CSV (ignored) | data/raw/Email_Marketing_Campaign_CTR_Dataset.csv |
| Prepared JSONL (ignored) | data/processed/train.jsonl and val.jsonl |
| Existing Colab notebook | notebooks/c4_finetune_mistral_qlora.ipynb |
| Preparation / verification | training/prepare_data.py and verify_artifacts.py |
| GPU trainer entrypoint | training/train.py (executes the reviewed notebook cells) |
| Saved-output evaluator | training/evaluate.py |
| Serving image / cache importer | serving/ |
| Saved adapter (ignored) | ../models/email-agent/c4-email-lora/ |

Prepared artifacts contain 715 training and 171 validation examples. Historical 25-prompt evaluation recorded all-seven-check pass rates of 24% for the base model and 76% for the fine-tuned adapter; grounding decreased from 92% to 76%. These are recorded generation checks, not a claim about deployed inference. Evidence is under ../../docs/evidence/c4-ft.

The saved adapter SHA256 is `d8e46c073ab2a16eedf828b0b2cb81ed91c16e9a516d0202257f54abde3cc530`. Its bytes were preserved during relocation. No hosted weights link has been configured; publish through your team's artifact store when needed. Existing build-report paths/hashes are historical and are not silently regenerated.

From the repository root:

```sh
python ml/email-agent/training/prepare_data.py --csv ml/email-agent/data/raw/Email_Marketing_Campaign_CTR_Dataset.csv --out ml/email-agent/data/processed --n 900
python ml/email-agent/training/verify_artifacts.py --csv ml/email-agent/data/raw/Email_Marketing_Campaign_CTR_Dataset.csv --data ml/email-agent/data/processed --report .local/email-artifact-verification.json
python ml/email-agent/training/evaluate.py --predictions docs/evidence/c4-ft/c4-ft_eval_fine-tuned.csv --report .local/email-evaluation.json
python ml/email-agent/training/train.py --help
```

Training is explicit, requires CUDA/PyTorch and component requirements, and is never run by Docker startup. The CLI uses the notebook's fixed reviewed hyperparameters; configs/lora.json records them. Notebook outputs and original Colab paths are preserved for provenance.

The email service has two independent opt-in loops. Aggregate results train a tenant-specific Beta-binomial engagement ranker; that loop does not change Mistral weights. The Learning center also provides a separate reviewed-text QLoRA queue and connected Colab worker that trains real workspace adapter weights, evaluates raw outputs and gates activation. See [Colab setup and limitations](../../docs/colab-qlora-automation.md). A public app/API origin and a live compatible GPU runtime are required; neither is provisioned automatically.

## Test fresh generation quality

`training/evaluate.py` reads saved outputs or recorded checks. `training/evaluate_live.py` makes fresh requests to the specified installed Ollama model without training, changing application settings, or repairing its output. It requires only Python's standard library and the repository's evaluation helpers.

Register the saved adapter first (requires Docker and the project's pinned model runtime):

```powershell
powershell -NoProfile -File ml/email-agent/serving/register-finetuned.ps1
```

This uses the matching `mistral:7b-instruct-v0.3-q4_K_M` base and the saved adapter under `ml/models/email-agent/c4-email-lora`. It imports an existing local base cache when present. If the base is absent, explicitly install it with `docker exec email-agent-model ollama pull mistral:7b-instruct-v0.3-q4_K_M` and retry. It uses the CLI inside the pinned Ollama 0.12.3 image; newer host clients may reject the older adapter recipe. Registration does not change the application's selected model and does not prove successful inference. The helper checks the resulting model's `ADAPTER` declaration and records the source adapter hash locally.

After registration, start with five prompts:

```powershell
python ml/email-agent/training/evaluate_live.py --model c4-email-ft --limit 5 --output-dir .local/email-ft-smoke
```

Then evaluate all 171 held-out validation prompts:

```powershell
python ml/email-agent/training/evaluate_live.py --model c4-email-ft --limit 171 --output-dir .local/email-ft-validation
```

The default endpoint is `http://127.0.0.1:11435`. The model must exist; the evaluator never falls back to the base model. Each output directory must be new. Requests run sequentially, default to a 150-second timeout, and may take substantial time on CPU. `--timeout` and `--num-predict` are configurable and should match across comparison runs.

If a model is listed but generation times out while loading tensors, that is a runtime/loading failure, not a measured accuracy result. Confirm a short generation completes before starting all 171 prompts. The evaluator also accepts `--num-ctx`, `--num-thread` and `--use-mmap` as explicit runtime requests, recorded in the report. Ollama 0.12.3 [disables memory mapping when a LoRA adapter is attached](https://github.com/ollama/ollama/blob/v0.12.3/runner/llamarunner/runner.go#L770), so `--use-mmap` does not resolve that adapter-loading constraint. A GPU environment, or a verified merged export, may be needed when local loading cannot complete; both require their own inference validation.

Outputs:

- `predictions.jsonl`: complete prompts, raw outputs, per-example checks, errors and latency.
- `summary.json`: model tag/digest, dataset hash, selected indices/settings, generation failures, per-check rates and overall rates.

`all_requirements_pass_rate * 100` is the percentage of attempted examples passing all seven reference checks plus strict JSON, email numbering and exact footer checks. Failed requests remain in the denominator. `reference_checks.all_checks` reports the seven reference checks alone. Grounding detects unsupported numbers and promo codes; it does not verify all factual claims. Have a human independently score relevance, tone and factual accuracy on unseen business cases.

For a baseline comparison, repeat the identical command with the exact compatible unmodified Mistral v0.3 base/quantization and a separate output directory. Keep dataset hash, limit, seed, runtime and generation options identical. The current generic Mistral tag has not been established as that matching baseline. New runs do not exactly reproduce historical notebook scores because runtime and prompt selection differ. For final research results, reserve a separate untouched test set after model selection.

Evaluator verification (local HTTP fixtures, no model weights):

```powershell
python -m unittest discover -s ml/email-agent/tests -p 'test_*.py' -v
```

Serving uses the existing `ciftron-email-agent-model:local` image and `ciftron_email_agent_models` volume, host port 11435. The saved adapter is not automatically deployed. `serving/Modelfile` is an opt-in recipe requiring base-version/adapter compatibility verification before activation. Raw data, weights and serving .local caches are excluded from Git and application build contexts.
