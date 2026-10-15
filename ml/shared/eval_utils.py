"""Aggregate explicit per-example boolean checks; no invented accuracy scores."""
def pass_rates(results):
    rows = list(results)
    if not rows:
        raise ValueError('At least one evaluated example is required')
    keys = tuple(rows[0])
    if any(set(row) != set(keys) or any(type(value) is not bool for value in row.values()) for row in rows):
        raise ValueError('Every example must contain the same boolean checks')
    return {'examples': len(rows), 'checks': {key: sum(row[key] for row in rows) / len(rows) for key in keys},
            'all_checks': sum(all(row.values()) for row in rows) / len(rows)}
