"""Chat-template helpers. Instruct models treat the `system` role differently:

  * Qwen2.5 renders a system message identically with or without an assistant reply after it;
  * older Mistral templates (v0.1 / v0.2) raise an error for it;
  * **Mistral-7B-Instruct v0.3 accepts it but silently DROPS it from the rendering as soon as an assistant reply follows**, so the training sequence
    (prompt + answer) no longer contains the instruction that the inference prompt does. TRL then also treats the prompt as just `<s>[INST]` and trains the
    loss on the brief itself. We found this on the first real GPU run. The fix is the same as for the first case: fold the system text into the user turn.

`render_chat` renders with the model's own template and, if that rejects the system role, folds the system text into the first user
turn, which is exactly what the Mistral `[INST]` format does anyway. Used by the generator and by the training scripts.
"""
from __future__ import annotations

from functools import lru_cache
from typing import Any


def merge_system_into_user(messages: list[dict]) -> list[dict]:
    system = [m["content"] for m in messages if m["role"] == "system"]
    rest = [dict(m) for m in messages if m["role"] != "system"]
    if system and rest and rest[0]["role"] == "user":
        rest[0]["content"] = "\n\n".join(system) + "\n\n" + rest[0]["content"]
    return rest


def accepts_system_role(tokenizer: Any) -> bool:
    try:
        tokenizer.apply_chat_template([{"role": "system", "content": "s"}, {"role": "user", "content": "u"}], tokenize=False)
        return True
    except Exception:
        return False


@lru_cache(maxsize=16)
def system_role_is_consistent(tokenizer: Any) -> bool:
    """True only if the template renders the system text in BOTH the prompt-only form (what inference and TRL's prompt use) and the form with an
    assistant answer appended (what training uses), and the first is a prefix of the second."""
    msgs = [{"role": "system", "content": "SYSPROBE"}, {"role": "user", "content": "USERPROBE"}]
    try:
        prompt = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        full = tokenizer.apply_chat_template(msgs + [{"role": "assistant", "content": "ANSWERPROBE"}], tokenize=False)
    except Exception:
        return False
    return "SYSPROBE" in prompt and "SYSPROBE" in full and full.startswith(prompt)


def needs_system_merge(tokenizer: Any) -> bool:
    return not system_role_is_consistent(tokenizer)


def normalise_messages(tokenizer: Any, messages: list[dict]) -> list[dict]:
    """Messages that this tokenizer's chat template renders the same way for inference and for training."""
    return merge_system_into_user(messages) if needs_system_merge(tokenizer) else messages


def render_chat(tokenizer: Any, messages: list[dict], add_generation_prompt: bool = False) -> str:
    return tokenizer.apply_chat_template(normalise_messages(tokenizer, messages), tokenize=False, add_generation_prompt=add_generation_prompt)
