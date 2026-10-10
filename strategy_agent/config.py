"""Typed settings, loaded from environment variables / a `.env` file. No secrets or tunables are hard-coded elsewhere."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_SECRET = "change-me-in-production-use-a-long-random-secret"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"), env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    app_env: str = "dev"

    # --- auth
    allow_dev_auth: bool = True
    jwt_secret: str = _DEFAULT_SECRET
    jwt_algorithm: str = "HS256"

    # --- storage
    tenant_db_path: str = "data/tenant.sqlite"
    shared_db_path: str = "data/shared.sqlite"

    # --- generator
    generator_backend: str = "auto"  # auto | llm | template
    llm_model_name: str = "Qwen/Qwen2.5-1.5B-Instruct"
    model_version: str = "prototype-v1"
    adapter_id: str = "none"      # an identifier recorded with every recommendation (for example "sft-v1")
    llm_load_4bit: bool = False   # load the LLM in 4-bit NF4 (needs an NVIDIA GPU + bitsandbytes); required for a 7B model on a 16 GB GPU
    adapter_path: str = ""        # a PEFT/LoRA adapter directory to load on top of the base model (empty = base model only)
    experiment_log_path: str = "experiments/runs.jsonl"
    n_strategies: int = Field(3, ge=1, le=5)
    rag_top_k: int = Field(3, ge=1, le=10)
    rag_backend: str = "auto"  # auto | tfidf | embeddings
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    max_new_tokens: int = Field(1800, ge=256)

    # --- privacy
    k_anonymity: int = Field(5, ge=2)
    laplace_epsilon: float = Field(1.0, gt=0)
    enable_laplace_noise: bool = False

    # --- ranking: score = w1*confidence + w2*uplift_similarity + w3*constraint_fit + w4*shared_support
    rank_w_confidence: float = 0.30
    rank_w_uplift: float = 0.30
    rank_w_constraint: float = 0.25
    rank_w_shared: float = 0.15

    # --- reward: reward = a*outcome_uplift + b*explicit_feedback
    reward_w_outcome: float = 0.6
    reward_w_feedback: float = 0.4

    @model_validator(mode="after")
    def _safe_outside_dev(self) -> "Settings":
        if self.app_env != "dev":
            if self.allow_dev_auth:
                raise ValueError("ALLOW_DEV_AUTH must be false outside dev")
            if self.jwt_secret == _DEFAULT_SECRET:
                raise ValueError("JWT_SECRET must be changed outside dev")
        return self

    @property
    def rank_weights(self) -> dict[str, float]:
        return {
            "confidence": self.rank_w_confidence,
            "uplift": self.rank_w_uplift,
            "constraint": self.rank_w_constraint,
            "shared": self.rank_w_shared,
        }

    @property
    def reward_weights(self) -> dict[str, float]:
        return {"outcome": self.reward_w_outcome, "feedback": self.reward_w_feedback}

    def resolve(self, path: str) -> Path:
        p = Path(path)
        return p if p.is_absolute() else PROJECT_ROOT / p


@lru_cache
def get_settings() -> Settings:
    return Settings()
