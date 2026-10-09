.PHONY: install test demo run eval eval-llm dataset batch clean

PY ?= .venv/bin/python

install:
	python3.11 -m venv .venv && $(PY) -m pip install -r requirements.txt && $(PY) -m spacy download en_core_web_sm

test:
	$(PY) -m pytest

demo:
	$(PY) -m strategy_agent.demo

run:
	$(PY) -m uvicorn strategy_agent.api.main:create_app --factory --port 8100

eval:
	$(PY) -m strategy_agent.eval.run --model template

eval-llm:
	$(PY) -m strategy_agent.eval.run --model llm --llm-briefs 6

dataset:
	$(PY) -m strategy_agent.data.seed_generator --n 1200 --seed 42 --out data/strategy_sft/v1

batch:
	$(PY) -m strategy_agent.privacy.pipeline --batch

clean:
	rm -rf data/tenant.sqlite data/shared.sqlite eval_reports outputs
