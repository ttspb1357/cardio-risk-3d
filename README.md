# CardioRisk 3D

Multimodal AI Hackathon 2026, Track A: predicts coronary artery disease (CAD) and LAD / LCX / RCA stenosis
from routine clinical data, explains every prediction, and maps the artery risks onto an interactive 3D heart.

> For decision support / educational use only. Not a substitute for diagnostic imaging.

**Live demo: https://cardiorisk3d.vercel.app** (the first visit after a quiet spell takes about 15 seconds while the models load).

## Run it on a new laptop (Windows)
**Easiest:** double-click **`start.bat`**. On the first start it installs the Python packages (and builds the
website if needed), then opens the app in the browser. It needs Python 3.10 to 3.13 (tested on 3.10 and 3.13;
3.14 is too new for numpy and shap). If you have none, install [Python 3.10](https://www.python.org/downloads/release/python-31011/)
and tick "Add python.exe to PATH". A GitHub copy also needs [Node.js LTS](https://nodejs.org/) (the demo ZIP already
contains the built website). To present the app, see [docs/DEMO.md](docs/DEMO.md).
Build the demo ZIP with `powershell -ExecutionPolicy Bypass -File tools\make_demo_zip.ps1`.

**Manual setup.** Install once: [Git](https://git-scm.com/download/win), Python 3.10 to 3.13
(e.g. [3.10](https://www.python.org/downloads/release/python-31011/); tick "Add python.exe to PATH") and
[Node.js LTS](https://nodejs.org/) (22 or newer).

**Setup, once** (in PowerShell; about 5 minutes, mostly downloads):
```
git clone https://github.com/ttspb1357/cardio-risk-3d.git
cd cardio-risk-3d
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
```
**Start** (every time):
```
.\.venv\Scripts\python -m uvicorn backend.app:app --port 8000
```
Open http://localhost:8000 and keep the PowerShell window open while using the app (Ctrl+C stops it).
Trained models, data and the 3D heart are all in the repository, so the app runs offline.

**Get the latest version** later: `git pull`, then rerun `npm run build` inside `frontend` if the website changed.

**If something goes wrong**
- `npm` says "running scripts is disabled on this system": run `npm.cmd ci` and `npm.cmd run build` instead
  (or use Command Prompt).
- `python` is not found: reinstall Python with "Add python.exe to PATH" ticked, or use `py -3.10` instead of `python`.
- "Address already in use": another program uses port 8000; start with `--port 8001` and open http://localhost:8001.
- The 3D heart stays empty: the browser needs WebGL (any recent Chrome, Edge or Firefox).

**Show it on other devices without installing** (phone, a judge's laptop on the same Wi-Fi): start with
`--host 0.0.0.0 --port 8000`, allow Python through the Windows firewall when asked (private networks only), find this
laptop's address with `ipconfig` (IPv4 Address), and open `http://<that address>:8000` on the other device.

**macOS / Linux:** same steps, with `.venv/bin/python` instead of `.\.venv\Scripts\python`.

## Development
- Tests and retraining need a few extra packages (CatBoost, pytest, httpx):
  `.\.venv\Scripts\python -m pip install -r requirements-dev.txt`
- Frontend with hot reload: keep the server running, then `cd frontend; npm run dev` and open http://localhost:5173
- Tests: `.\.venv\Scripts\python -m pytest tests`
- Retrain from scratch (optional):
  ```
  .\.venv\Scripts\python ml\evaluate.py   # repeated nested CV, ~15 min on 20 cores (--quick smoke test, --summarize to re-summarise)
  .\.venv\Scripts\python ml\train.py      # final models + app artifacts, ~3 min
  ```

## Deploy (Vercel)
The whole app (website, 3D heart and prediction API) runs as one FastAPI function on Vercel: `app.py` is the entrypoint,
`vercel.json` sets the framework, `.vercelignore` keeps local files out of the upload, and `requirements.txt` holds only
runtime packages (with the CPU-only xgboost on Linux, which keeps the bundle under Vercel's 500 MB Python limit).
Build the website first (`npm run build` in `frontend`), then from the project root:
```
npx vercel login
npx vercel deploy --prod --yes
```

## Models
The app uses four final models, one per target. Each is calibrated with Platt scaling and has its own decision threshold.

| Target | Final model | Decision threshold |
|---|---|---|
| Overall CAD | logistic regression (L1, C=0.3) | 74% |
| LAD | random forest (min leaf 3) | 62% |
| LCX | average of XGBoost (depth 2) and P(CAD) × P(LCX \| CAD): logistic regression (L1, C=0.3) × random forest (min leaf 5) | 37% |
| RCA | logistic regression (L1, C=0.1) | 38% |

**How they were chosen.** Model selection happened during development (`ml/selection.py`); nothing is re-selected
while the app runs.
- 17 candidates competed: logistic regression (L1 and L2, several strengths), random forest, extra trees, XGBoost,
  histogram gradient boosting and CatBoost (`ml/models.py`).
- Each artery was modelled directly, as P(CAD) × P(artery | CAD) (trained on CAD patients only), and as ensembles of
  two or three model families. Every configuration was scored by ROC-AUC with repeated stratified 5-fold
  cross-validation.
- Among the configurations within one standard error of the best AUC, the simplest was kept. Platt calibration was
  kept only if it lowered the cross-validated Brier score, and the threshold maximises sensitivity + specificity
  (Youden's J).
- To measure performance honestly, this whole procedure was rerun inside every outer fold of a repeated nested
  cross-validation (5 folds × 3 repeats outside, 5 × 2 inside, `ml/evaluate.py`), so no score below comes from a
  patient the selection saw. The final models were then trained on all patients except the six demo patients
  (`ml/train.py`), who stay unseen for the demo.

## Results (repeated nested cross-validation, 303 patients)
| Target | ROC-AUC (95% CI) | Sensitivity | Specificity | Calibration error |
|---|---|---|---|---|
| Overall CAD | 0.919 (0.886–0.948) | 83% | 86% | 1.6% |
| LAD | 0.845 (0.802–0.886) | 84% | 72% | 5.1% |
| LCX | 0.720 (0.664–0.772) | 73% | 62% | 4.4% |
| RCA | 0.722 (0.671–0.772) | 73% | 61% | 3.2% |

On ranking (AUC) the pipeline ties with plain logistic-regression and random-forest baselines scored in the same folds;
its probabilities are markedly better calibrated (overall CAD: 1.6% calibration error vs 11.6% for a random forest).
The app's *Validation* page shows ROC curves, calibration plots, confusion matrices and the baseline comparison.

## Layout
- `ml/` data (`data.py`), model zoo (`models.py`), selection (`selection.py`), nested CV (`evaluate.py`),
  final training (`train.py`), exact probability-scale SHAP for composite models (`composite.py`),
  display metadata (`feature_meta.json`); `ml/artifacts/` holds models and metrics
- `backend/` FastAPI app: `/predict`, `/features`, `/metrics`, `/samples`, `/health`, plus the built frontend
- `frontend/` React + TypeScript + Vite app; `src/three/heart.ts` is the 3D scene, `src/pages/` the three pages
- `tools/anatomy/` builds the anatomical 3D heart (`frontend/public/models/heart.glb`) from BodyParts3D
- `docs/` API contract and status

Rebuild the 3D heart (optional, the model is committed):
```
.\.venv\Scripts\python -m pip install -r tools\anatomy\requirements.txt
.\.venv\Scripts\python tools\anatomy\build_heart.py   # downloads the anatomy, trims, simplifies, compresses (~1 MB)
```

## Data and credits
- Patient data: extension of the Z-Alizadeh Sani dataset (303 patients; adds LAD/LCX/RCA labels), Mendeley Data:
  https://data.mendeley.com/datasets/bgf5czvpg2/1
- Anatomy: BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan
  (http://lifesciencedb.jp/bp3d/), via the mirror https://github.com/Kevin-Mattheus-Moerman/BodyParts3D.
  `frontend/public/models/heart.glb` is derived from it and is shared under the same licence.
