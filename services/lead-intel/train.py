# services/lead-intel/train.py  — C3-04
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import RocCurveDisplay, f1_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.pipeline import Pipeline
from baseline import rule_score
from features import load, build_preprocessor, split, NUMERIC, CATEGORICAL, SALES_FIELDS

pd.set_option("display.width", 200)
train, val, test = split(load())

MODELS = {
    "LogisticRegression": lambda: LogisticRegression(max_iter=2000, class_weight="balanced"),
    "RandomForest": lambda: RandomForestClassifier(n_estimators=300, class_weight="balanced",
                                                   random_state=42, n_jobs=-1),
    "GradientBoosting": lambda: GradientBoostingClassifier(random_state=42),
}
FEATURE_SETS = {
    "behavioural (main)": CATEGORICAL,
    "behavioural + sales fields (leakage check)": CATEGORICAL + SALES_FIELDS,
}
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
METRICS = ["roc_auc", "f1", "precision", "recall"]

rows = []
for fs_name, cats in FEATURE_SETS.items():
    X, y = train[NUMERIC + cats], train.converted
    for name, make in MODELS.items():
        print("Running", name, "-", fs_name, "...")
        pipe = Pipeline([("prep", build_preprocessor(cats)), ("model", make())])
        r = cross_validate(pipe, X, y, cv=cv, scoring=METRICS)
        rows.append({"features": fs_name, "model": name,
                     **{m: round(r[f"test_{m}"].mean(), 3) for m in METRICS},
                     "auc_std": round(r["test_roc_auc"].std(), 3)})
table = pd.DataFrame(rows)
table.to_csv("reports/c3-04_model_comparison.csv", index=False)
print("\n5-fold CV on the training set (6,468 leads):")
print(table.to_string(index=False))

# Pick the best model on the MAIN (behavioural) feature set by CV AUC
main = table[table.features == "behavioural (main)"]
best_name = main.sort_values("roc_auc", ascending=False).iloc[0]["model"]
best = Pipeline([("prep", build_preprocessor()), ("model", MODELS[best_name]())])
best.fit(train[NUMERIC + CATEGORICAL], train.converted)

# Final check on the untouched test set, against the rule-based baseline
p = best.predict_proba(test[NUMERIC + CATEGORICAL])[:, 1]
auc_ml = roc_auc_score(test.converted, p)
auc_rule = roc_auc_score(test.converted, test.apply(rule_score, axis=1))
print(f"\nChosen model (best CV AUC, behavioural features): {best_name}")
print(f"Test AUC  ML: {auc_ml:.3f}   rule baseline: {auc_rule:.3f}   difference: {auc_ml - auc_rule:+.3f}")
print(f"Test F1 (threshold 0.5): {f1_score(test.converted, p >= 0.5):.3f}")

ax = plt.gca()
RocCurveDisplay.from_predictions(test.converted, p, name=best_name, ax=ax)
RocCurveDisplay.from_predictions(test.converted, test.apply(rule_score, axis=1),
                                 name="Rule-based baseline", ax=ax)
plt.title("C3-04 ROC curve – test set (1,386 leads)")
plt.savefig("reports/c3-04_roc.png", dpi=150, bbox_inches="tight")
print("Saved reports/c3-04_model_comparison.csv and reports/c3-04_roc.png")