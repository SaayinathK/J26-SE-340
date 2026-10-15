"""Run the existing QLoRA notebook cells on a GPU using local data paths.

This delegates to the reviewed notebook rather than maintaining a second trainer.
Dependencies and CUDA are required. Nothing is trained merely by importing this file.
"""
import argparse
import json
import os
import shutil
from pathlib import Path

def main():
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=root / 'ml/email-agent/data/processed')
    parser.add_argument('--output', type=Path, default=root / 'ml/models/email-agent/training-run')
    parser.add_argument('--model', default='unsloth/mistral-7b-instruct-v0.3')
    args = parser.parse_args()
    for name in ('train.jsonl', 'val.jsonl'):
        if not (args.data / name).is_file():
            parser.error('Missing prepared data: ' + str(args.data / name))
    args.output.mkdir(parents=True, exist_ok=True)
    for name in ('train.jsonl', 'val.jsonl'):
        destination = args.output / name
        if destination.exists() and destination.read_bytes() != (args.data / name).read_bytes():
            parser.error('Output contains different data; choose a new output directory')
        if not destination.exists():
            shutil.copy2(args.data / name, destination)
    os.environ['C4_WORK'] = str(args.output.resolve())
    os.environ['C4_MODEL'] = args.model
    notebook = json.loads((root / 'ml/email-agent/notebooks/c4_finetune_mistral_qlora.ipynb').read_text(encoding='utf-8'))
    namespace = {'__name__': '__main__'}
    for index in range(2, 9):
        exec(compile(''.join(notebook['cells'][index]['source']), f'email-notebook-cell-{index}', 'exec'), namespace)

if __name__ == '__main__':
    main()
