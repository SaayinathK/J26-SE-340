# services/lead-intel/features.py  — C3-02
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder, StandardScaler

RAW_NUMERIC = ["total_visits", "time_on_site_sec", "pages_per_visit"]
NUMERIC = RAW_NUMERIC + ["time_per_visit"]
CATEGORICAL = ["source", "lead_origin", "last_activity", "occupation", "specialization"]
# Filled in by sales staff, sometimes after the outcome is known -> leakage (see EDA)
SALES_FIELDS = ["tag", "lead_quality", "lead_profile", "last_notable_activity"]

def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in RAW_NUMERIC:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    # RFM-style: frequency = visits, engagement = time on site,
    # intensity = time per visit, recency proxy = type of last activity
    df["time_per_visit"] = df["time_on_site_sec"] / (df["total_visits"].fillna(0) + 1)
    if "tags" in df:
        df["tag"] = df["tags"].apply(lambda t: t[0] if isinstance(t, list) and t else np.nan)
    for c in CATEGORICAL + SALES_FIELDS:
        if c in df:
            df[c] = df[c].astype("object").where(df[c].notna(), np.nan)
    return df

def build_preprocessor(categorical=CATEGORICAL) -> ColumnTransformer:
    num = Pipeline([
        ("impute", SimpleImputer(strategy="median")),
        ("log", FunctionTransformer(np.log1p, feature_names_out="one-to-one")),
        ("scale", StandardScaler()),
    ])
    cat = Pipeline([
        ("impute", SimpleImputer(strategy="constant", fill_value="Unknown")),
        ("onehot", OneHotEncoder(handle_unknown="infrequent_if_exist",
                                 min_frequency=30, sparse_output=False)),
    ])
    return ColumnTransformer([("num", num, NUMERIC), ("cat", cat, list(categorical))])

def split(df: pd.DataFrame):
    """70 / 15 / 15, stratified on the label, fixed seed."""
    train, temp = train_test_split(df, test_size=0.30, stratify=df["converted"], random_state=42)
    val, test = train_test_split(temp, test_size=0.50, stratify=temp["converted"], random_state=42)
    return train, val, test

def load() -> pd.DataFrame:
    return add_features(pd.read_json("data/processed/leads_ghl.jsonl", lines=True))

if __name__ == "__main__":
    df = load()
    tr, va, te = split(df)
    print("Train / Val / Test:", len(tr), len(va), len(te))
    print("Conversion rate:", round(tr.converted.mean(), 3), round(va.converted.mean(), 3), round(te.converted.mean(), 3))
    X = build_preprocessor().fit_transform(tr[NUMERIC + CATEGORICAL])
    print("Feature matrix:", X.shape)