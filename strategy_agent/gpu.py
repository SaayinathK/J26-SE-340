"""GPU capability checks shared by training and inference.

`torch.cuda.is_bf16_supported()` answers True on a T4 in current PyTorch, because it counts *emulated* bf16. Emulation is fine for plain
matmuls but not for every kernel: TRL's chunked-loss kernel multiplies bf16 inputs into an fp32 output, which the hardware only supports from
compute capability 8.0 (Ampere: A100, L4, RTX 30xx) on. So the compute dtype is chosen from the hardware capability, not from that flag.
"""
from __future__ import annotations

import importlib
from typing import Optional

TRL_CHUNKED_KERNELS = ("trl.kernels.chunked_logprob", "trl.kernels.chunked_divergence")


def compute_capability() -> Optional[tuple[int, int]]:
    """(major, minor) of GPU 0, or None without CUDA."""
    import torch

    return tuple(torch.cuda.get_device_capability(0)) if torch.cuda.is_available() else None


def native_bf16() -> bool:
    """True only when the GPU runs bf16 in hardware (compute capability 8.0 or higher)."""
    cc = compute_capability()
    return cc is not None and cc[0] >= 8


def prepare_pre_ampere() -> bool:
    """On a GPU older than Ampere (T4, V100), make TRL's chunked-loss kernels take their plain fp32 matmul path instead of the
    mixed-precision `addmm(out_dtype=float32)` call. It is a no-op on Ampere or newer, on CPU, and with a TRL that has no such kernel.
    Returns True when something was changed."""
    cc = compute_capability()
    if cc is None or cc[0] >= 8:
        return False
    changed = False
    for name in TRL_CHUNKED_KERNELS:
        try:
            module = importlib.import_module(name)
        except Exception:  # an older TRL without the kernel: nothing to switch off
            continue
        if getattr(module, "_MM_OUT_DTYPE", False):
            module._MM_OUT_DTYPE = False
            changed = True
    return changed
