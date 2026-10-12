# Machine learning assets

`shared/` contains data/hash helpers, explicit evaluation aggregation and a trainer interface. Each agent owns data preparation, notebooks, training settings and model serving. `models/`, `*/data/raw/`, `*/data/processed/` and serving `.local/` caches are ignored.

Email Agent has an existing QLoRA notebook, prepared datasets, saved adapter and evaluation evidence. See [email ML](email-agent/README.md). Content, lead and strategy have explicit pending entrypoints; their containers do not perform inference. Strategy's `fl/` files reserve the requested federated-learning structure and raise `NotImplementedError`.

The existing root Python environment and `requirements.txt` were retained for compatibility. Use component-specific requirements for new work; web application startup does not install training dependencies.
