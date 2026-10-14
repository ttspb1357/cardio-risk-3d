// Method & limitations: how the system works, in plain language.
import { Box, Database, FlaskConical, Layers, Lightbulb, Lock, OctagonAlert, Target } from "lucide-react";
import type { ReactNode } from "react";
import { Eyebrow } from "../components/ui";

function Card({ icon, title, children, tone }: { icon: ReactNode; title: string; children: ReactNode; tone?: "warn" }) {
  return (
    <article className={`panel method-card${tone ? ` tone-${tone}` : ""}`}>
      <div className="method-icon" aria-hidden="true">{icon}</div>
      <h2>{title}</h2>
      {children}
    </article>
  );
}

export function MethodPage() {
  return (
    <div className="method">
      <header className="hero">
        <Eyebrow>Method & limitations</Eyebrow>
        <h1>How CardioRisk 3D works, and what it cannot do</h1>
        <p className="lede">
          From routine clinical data (history, examination, ECG, blood tests and echocardiography), the system estimates
          the probability of coronary artery disease and of significant narrowing in each main coronary artery. It explains
          every prediction and shows the artery-level risks on a 3D heart.
        </p>
      </header>
      <div className="method-grid">
        <Card icon={<Database size={20} />} title="Data">
          <p>The <a href="https://data.mendeley.com/datasets/bgf5czvpg2/1" target="_blank" rel="noreferrer">extension of the Z-Alizadeh Sani dataset</a>:
            303 patients, 54 inputs and the angiography result for LAD, LCX and RCA. CAD means at least one artery narrowed by 50% or more.
            Every CAD patient has at least one stenotic artery (with one exception).</p>
        </Card>
        <Card icon={<Lock size={20} />} title="No target leakage">
          <p>The angiography columns (LAD, LCX, RCA, Cath) are never model inputs. Training stops if one slips in, the API rejects
            them, and automated tests check both.</p>
        </Card>
        <Card icon={<Layers size={20} />} title="Models">
          <ul>
            <li><b>Overall CAD:</b> logistic regression (L1).</li>
            <li><b>LAD:</b> random forest.</li>
            <li><b>LCX:</b> average of two models: XGBoost, and <b>P(CAD) × P(LCX | CAD)</b> (logistic regression for CAD,
              random forest for the LCX given CAD).</li>
            <li><b>RCA:</b> logistic regression (L1).</li>
            <li>All four are calibrated (Platt scaling) so their percentages match observed rates, and each has its own
              decision threshold: CAD 74%, LAD 62%, LCX 37%, RCA 38%.</li>
          </ul>
        </Card>
        <Card icon={<FlaskConical size={20} />} title="Validation">
          <p><b>Repeated nested cross-validation</b>: the whole pipeline is re-run inside every outer fold, so each patient is scored by
            a model that never saw them. A single 80/20 hold-out proved too noisy at this size: the same model scored anywhere from
            0.83 upward (mean 0.92) across 100 random splits.</p>
        </Card>
        <Card icon={<Lightbulb size={20} />} title="Explanations">
          <p>Exact SHAP values (TreeSHAP or linear SHAP), converted to percentage points of risk. For combined and calibrated models,
            the parts are merged exactly, so baseline + contributions always equals the displayed risk.</p>
        </Card>
        <Card icon={<Box size={20} />} title="3D mapping">
          <p>Real human anatomy from BodyParts3D: the heart wall, great vessels, cardiac veins and the actual LAD, LCX and RCA
            (with their branches) as separate structures, with baked ambient occlusion and epicardial fat. Each artery is coloured
            by its own predicted probability. It is a reference heart: it shows which artery a prediction refers to, not this
            patient's anatomy or where a lesion is.</p>
        </Card>
        <Card icon={<Target size={20} />} title="Territory map">
          <p>The ventricles are divided into the American Heart Association's 17 segments (plus the right-ventricle wall),
            derived from the heart's own geometry: the long axis runs from the atrioventricular groove to the apex, and the
            left-ventricle wall is bounded by the grooves of the LAD and the posterior descending artery. Each segment takes the
            risk colour of the artery that <b>typically</b> supplies it (standard AHA assignment), on the heart and on the
            bullseye. Real supply varies between people (for example, which artery is dominant).</p>
        </Card>
        <Card icon={<Target size={20} />} title="Demo patients">
          <p>The deployed model is trained on all patients except six demo patients. The demo patients are genuinely unseen, and
            their recorded angiography is shown next to the prediction for comparison.</p>
        </Card>
        <Card icon={<OctagonAlert size={20} />} title="Limitations" tone="warn">
          <ul>
            <li>303 patients from one source, never validated on another population.</li>
            <li>LCX and RCA are hard to predict: there is no lead-specific ECG or imaging data to locate a blockage.</li>
            <li>SHAP shows how the model uses a measurement, not what causes disease.</li>
            <li>Missing inputs are filled with typical values, which lowers reliability.</li>
            <li>An educational prototype. <b>Not for clinical decisions.</b></li>
          </ul>
        </Card>
      </div>
      <p className="credits muted small">
        Data: Alizadehsani et al., extension of the Z-Alizadeh Sani dataset (Mendeley Data). Anatomy: BodyParts3D,
        © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan
        (lifesciencedb.jp/bp3d); the web model derived from it is shared under the same licence. Built with scikit-learn,
        XGBoost, CatBoost, SHAP, FastAPI, React and Three.js.
      </p>
    </div>
  );
}
