"""Score saved generation outputs against the email checks without retraining."""
import argparse
import csv
import json
import sys
from pathlib import Path
from verify_artifacts import check, CHECKS
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from shared.eval_utils import pass_rates

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--predictions', type=Path, required=True, help='CSV/JSONL with prompt/output, or the existing CSV with recorded boolean checks')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    with args.predictions.open(encoding='utf-8-sig', newline='') as handle:
        rows = list(csv.DictReader(handle)) if args.predictions.suffix == '.csv' else [json.loads(line) for line in handle if line.strip()]
    if rows and all('prompt' in row and 'output' in row for row in rows):
        report = pass_rates(check(row['prompt'], row['output']) for row in rows)
        report['mode'] = 'rescored_saved_generations'
    elif rows and all(all(key in row for key in CHECKS) for row in rows):
        def boolean(value):
            if str(value).lower() not in ('true', 'false'):
                raise ValueError('Recorded checks must be True or False')
            return str(value).lower() == 'true'
        report = pass_rates({key: boolean(row[key]) for key in CHECKS} for row in rows)
        report['mode'] = 'aggregated_recorded_checks_not_rescored'
    else:
        parser.error('Input must contain prompt/output or all seven recorded check columns')
    report['source'] = str(args.predictions)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
