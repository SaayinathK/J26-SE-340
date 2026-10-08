# services/lead-intel/calibrate.py  — C3-05
import joblib
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.pipeline import Pipeline
from features import load, build_preprocessor, split, NUMERIC, CATEGORICAL

train, val, test = split(load())
X_tr, y_tr = train[NUMERIC + CATEGORICAL], train.converted

def make():
    return Pipeline([("prep", build_preprocessor()),
                     ("model", GradientBoostingClassifier(random_state=42))])

# Calibrated model: a score of 80 should mean about 80% of such leads convert
calibrated = CalibratedClassifierCV(make(), method="isotonic", cv=5).fit(X_tr, y_tr)
# Same model, uncalibrated: used only to explain scores with SHAP (C3-06)
explainer_pipe = make().fit(X_tr, y_tr)

p_val = calibrated.predict_proba(val[NUMERIC + CATEGORICAL])[:, 1]
print("Validation AUC:", round(roc_auc_score(val.converted, p_val), 3))
print("Brier score (lower is better):", round(brier_score_loss(val.converted, p_val), 4))

# Threshold rationale: real conversion rate inside each segment
band = pd.cut(p_val * 100, [0, 40, 70, 101], right=False, labels=["cold", "warm", "hot"])
seg = (pd.DataFrame({"segment": band, "converted": val.converted.values})
         .groupby("segment", observed=False).converted.agg(leads="size", conversion_rate="mean").round(3))
print("\nSegments on validation set (cold <40, warm 40-69, hot >=70):")
print(seg)
seg.to_csv("reports/c3-05_segments.csv")

joblib.dump({"calibrated": calibrated, "explainer_pipe": explainer_pipe,
             "model_version": "c3-gbm-v1"}, "models/lead_scorer.joblib")
print("\nSaved models/lead_scorer.joblib and reports/c3-05_segments.csv")
# ---- Explanations (SHAP): why does the model give a lead its score? ----
import numpy as np
import shap

prep = explainer_pipe.named_steps["prep"]
gbm = explainer_pipe.named_steps["model"]
explainer = shap.TreeExplainer(gbm)
names = prep.get_feature_names_out()

# Global: which features matter most overall (sample of 300 validation leads)
X_val = prep.transform(val[NUMERIC + CATEGORICAL].head(300))
sv = explainer.shap_values(X_val)
importance = pd.Series(np.abs(sv).mean(axis=0), index=names).sort_values(ascending=False)
print("\nTop 10 factors overall (mean |SHAP|):")
print(importance.head(10).round(3))
importance.head(10).round(4).to_csv("reports/c3-05_shap_top_factors.csv", header=["mean_abs_shap"])

# Local: explanation for one example lead
one = val[NUMERIC + CATEGORICAL].head(1)
score = int(round(calibrated.predict_proba(one)[0, 1] * 100))
sv_one = explainer.shap_values(prep.transform(one))[0]
top = sorted(zip(names, sv_one), key=lambda t: abs(t[1]), reverse=True)[:3]
print(f"\nExample lead: score {score}/100")
for f, v in top:
    print(f"  {'+' if v > 0 else '-'} {f}  ({v:+.3f})")
print("Saved reports/c3-05_shap_top_factors.csv")
