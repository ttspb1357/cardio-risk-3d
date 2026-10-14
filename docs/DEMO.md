# CardioRisk 3D: how to show it

## Start the app
1. Unzip the folder (or clone it from GitHub).
2. Double-click **`start.bat`**. The first start installs the Python packages (needs internet, a few minutes).
   Later starts take about 10 seconds.
3. The browser opens at http://localhost:8000 by itself. Keep the black window open while presenting.

Needs Python 3.10 to 3.13 (not 3.14). If you have none, install 3.10 from
https://www.python.org/downloads/release/python-31011/ and tick "Add python.exe to PATH".
Use Chrome or Edge. Start the app 5 minutes before presenting, so nothing is installing on stage.

## The 5-minute demo
| Step | Do this | Say this |
|---|---|---|
| 1 | Point at the yellow banner | "An educational decision-support prototype. It does not diagnose and does not replace angiography." |
| 2 | Default patient (#41, no stenosis); scroll the right column down to **Ground truth** | "From routine clinical data it estimates coronary artery disease: 7%, low risk. This card shows the real angiography result, which the model never saw: it agrees on all four." |
| 3 | Scroll down to **What-if mode**, click **Pin this result**, scroll back up | "Let's change this patient." |
| 4 | Left panel: **Typical chest pain → Yes**, drag **Age** to 65 | "The risk jumps to 90%, the arteries turn amber, and every card shows the change against the pinned result." |
| 5 | Click the **LAD** card (or the LAD artery on the heart) | "The LAD glows, and the heart muscle it supplies (front wall and apex) takes its risk colour." |
| 6 | Heart toolbar: **▶** (guided tour) | "A guided tour of the three main arteries, with each one's risk and the region it supplies." |
| 7 | **X-ray** (eye icon), **All territories** (layers icon), view buttons **Front / Left / Back / Below** | "All three arteries at once, and the full territory map." |
| 8 | Hover the **bullseye** (right column, below the arteries) | "The standard 17-segment chart cardiologists use, linked to the 3D heart." |
| 9 | Scroll to **What drives this risk** | "Every prediction is explained: starting from the baseline, each bar is a factor in percentage points, and they add up exactly to this patient's risk." |
| 10 | Open **Validation** | "Measured with repeated nested cross-validation on all 303 patients: every patient is scored by a model that never saw them." |
| 11 | Open **Method & limits** | "How we prevented target leakage, and the limitations, stated openly." |

## Numbers to quote
- Overall CAD: ROC-AUC **0.92** (95% CI 0.89–0.95), sensitivity 83%, specificity 86%.
- LAD 0.85, LCX 0.72, RCA 0.72.
- Calibration error **1.6%** for our CAD model against 11.6% for a plain random forest: our percentages can be trusted.
- 303 patients, 54 inputs; repeated nested cross-validation (5 folds × 3 repeats); 17 candidate models compared.

## Likely questions
- **Target leakage?** LAD, LCX, RCA and Cath are never inputs: training stops if one slips in, the API rejects
  them, and automated tests check both.
- **Why nested cross-validation?** With 303 patients a single 80/20 test split is too noisy: across 100 random
  splits the same model scored anywhere from 0.83 upward (mean 0.92). Nested CV repeats the whole model selection
  inside every fold.
- **Why are LCX and RCA weaker?** The dataset has no information that shows where a blockage is (lead-by-lead ECG,
  imaging), so any model reaches a ceiling there.
- **Does it beat a simple model?** On ranking (AUC) it ties with logistic regression and random forest. Its
  advantage is trustworthy (calibrated) probabilities and exact explanations. We show this comparison openly.
- **What is SHAP?** A method that splits each prediction into the contribution of every measurement. The
  contributions add up to the predicted risk.
- **Is that the patient's heart?** No. It is real human anatomy from BodyParts3D, used as a reference heart. The
  colours show which artery a risk refers to, not where a blockage is. The territories are the textbook supply
  regions; real anatomy varies between people.

## Never say
"It diagnoses", "99% accurate", or "this is the patient's own heart".

## If something goes wrong
- **"Can't reach the model server":** the black window was closed. Double-click `start.bat` again.
- **The 3D heart stays empty:** use Chrome or Edge with hardware acceleration switched on.
- **"Address already in use":** the app is already running in another window. Use that one.
