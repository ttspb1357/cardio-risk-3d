# Status

## Done (working end to end)
- Data: extended Z-Alizadeh Sani (303 patients). Display metadata in `ml/feature_meta.json`, read live by the backend.
- ML: 17 candidate models; vessels modelled directly or factorised as P(CAD) x P(vessel | CAD); ensembles;
  1-SE-rule selection; Platt calibration; Youden threshold. Exact SHAP in percentage points for every composite model.
- Validation: repeated nested CV (5x3 outer, 5x2 inner) with bootstrap CIs, calibration error, and two baselines
  scored in the same folds. A single 80/20 hold-out was dropped: across 100 random splits the same model scored
  from 0.83 up (mean 0.92). A calibrated random forest was also checked (scratch analysis): it ties on every metric.
- Deployed model: trained on all patients except 6 demo patients (demo patients are unseen).
- Backend: input validation (unknown keys, out-of-domain values -> 422), warm-up at start-up, serves `frontend/dist`.
- Frontend (React + TypeScript + Vite, dark "clinical HUD" design):
  - Assessment cockpit: patient panel with key-factor sliders (reference range drawn on each slider) | 3D heart with
    holographic stage, glowing risk-coloured arteries and HUD labels | animated CAD gauge, artery cards, ground truth.
  - Risk waterfall (baseline -> each factor -> this patient) per target, key drivers, what-if pinning with deltas,
    physiological breakdown table with filters, drawer with all 54 inputs and search, print report.
  - Validation page (tiles with CIs, baseline dot plot, calibration-error bars, ROC, calibration, confusion matrix,
    drivers, all metrics, under-the-hood details) and Method & limits page.
  - Responsive down to phone width; checked with an automated Playwright walkthrough (0 console errors).
- 3D heart: real anatomy from BodyParts3D (CC BY-SA 2.1 JP), built by `tools/anatomy/build_heart.py`:
  heart wall, aorta, pulmonary artery/veins, venae cavae, cardiac veins, and the real LAD / LCX / RCA (+ branches)
  as separate meshes. Vessels are cut with sealed caps near the heart; heart surface tinted myocardium + epicardial
  fat along the arteries; compressed to ~1.1 MB (meshopt). Arteries glow in their risk colour, are clickable
  (verified by an automated hover scan) and carry HUD labels on the proximal/mid segments.
- 3D round 2:
  - Territory map: AHA 17 segments + RV wall computed from the heart's geometry (AV-groove plane -> long axis, LAD and
    PDA grooves bound the LV wall), stored per vertex; the selected artery's territory is tinted with its risk colour
    ("all territories" button tints all three, with dark borders between them). Linked AHA bullseye card: hover or
    click a segment and it pulses on the 3D heart.
  - Camera views (front / left / back / below, smooth flights), a guided tour of LAD -> LCX -> RCA with captions,
    X-ray mode (tissue fades, all arteries visible and clickable through the wall).
  - Realism: ray-traced ambient occlusion baked into vertex colours (Embree), enclosed chamber linings removed,
    epicardial fat in the AV groove + natural patches, procedural tissue micro-relief and a translucent red rim in
    the shader, aorta segments fused (no seams), lung-vessel stumps trimmed, platform fades for views from below.
  - Fixed a load-time bug: the first frame's time step can be negative (measured -0.74 s); easing now clamps it.
- Tests: 12 backend tests passing (`python -m pytest tests`); `npm run build` type-checks the frontend.

## Key honest finding
On AUC the selection pipeline ties with plain baselines (per fold): CAD 0.928 vs LR 0.927 / RF 0.927;
LAD 0.852 vs RF 0.860; LCX 0.724 vs RF 0.749; RCA 0.734 vs LR 0.737. Its value is calibration
(CAD calibration error 1.6% vs 11.6% for a plain RF) and explainability. LCX/RCA are limited by the data.

## Next (see the roadmap discussed with the team)
1. 3D extras (optional): realistic two-phase heartbeat, blood-flow pulses in the arteries, translucent torso.
2. Clinical-score comparison (ESC / Diamond-Forrester pre-test probability) and decision-curve analysis.
3. "What would lower this risk?" counterfactuals, similar patients, per-patient uncertainty.
4. Documentation (max 6 pages), demo video script, Docker + deployment.
5. Add teammates to the GitHub repo.
