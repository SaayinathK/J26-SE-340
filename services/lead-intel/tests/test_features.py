# services/lead-intel/tests/test_features.py   run: pytest -q
import pandas as pd
from features import load, build_preprocessor, split, NUMERIC, CATEGORICAL

df = load()

def test_split_is_70_15_15_and_stratified():
    tr, va, te = split(df)
    assert abs(len(tr) / len(df) - 0.70) < 0.01
    assert abs(len(va) / len(df) - 0.15) < 0.01
    assert abs(tr.converted.mean() - te.converted.mean()) < 0.02

def test_no_missing_values_after_preprocessing():
    tr, _, _ = split(df)
    X = build_preprocessor().fit_transform(tr[NUMERIC + CATEGORICAL])
    assert not pd.isna(X).any()
    