// Shapes of the FastAPI responses (see docs/api.md).

export type Target = "cad" | "LAD" | "LCX" | "RCA";
export type Vessel = "LAD" | "LCX" | "RCA";
export type Band = "low" | "medium" | "high";
export type Value = number | string;
export type Values = Record<string, Value>;

export interface Feature {
  name: string;
  type: "number" | "choice" | "yesno" | "binary";
  label: string;
  unit: string | null;
  group: string;
  ref: [number | null, number | null] | null;
  desc: string | null;
  flag_if_present: boolean;
  default: Value;
  options?: Value[];
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface Schema {
  groups: string[];
  key_inputs: string[];
  features: Feature[];
}

export interface Sample {
  id: number;
  label: string;
  values: Values;
  truth: Record<"cad" | Vessel, string>;
}

export interface Contribution {
  feature: string;
  value: Value | null;
  contribution: number;
}

export interface Risk {
  probability: number;
  baseline: number;
  risk: Band;
  threshold: number;
}

export interface Prediction {
  cad: Risk & { label: "CAD" | "Normal" };
  vessels: Record<Vessel, Risk>;
  explanations: Record<Target, Contribution[]>;
  imputed_features: string[];
  disclaimer: string;
}

export type MetricKey = "roc_auc" | "brier" | "accuracy" | "sensitivity" | "specificity" | "precision" | "f1";
export interface CI { value: number; lo: number; hi: number }
export interface MeanSd { mean: number; sd: number }

export interface Nested {
  pooled: Record<MetricKey, CI>;
  per_fold: Record<MetricKey, MeanSd>;
  roc: [number, number][];
  calibration: { pred: number; obs: number; n: number }[];
  calibration_error?: number;
  confusion_repeat1: { tn: number; fp: number; fn: number; tp: number };
  selected_configs: { config: string; description: string; folds: number }[];
  baselines: Record<string, { roc_auc: MeanSd; brier?: number; calibration_error?: number }>;
}

export interface TargetMetrics {
  config: string;
  description: string;
  calibrated: boolean;
  threshold: number;
  baseline_risk: number;
  positive_rate: number;
  leaderboard: { config: string; auc: number; auc_se: number; brier: number }[];
  n_configs_tried: number;
  importance: { feature: string; mean_abs: number }[];
  nested: Nested | null;
}

export interface Metrics {
  protocol: {
    n_total: number;
    n_deploy_train: number;
    n_demo: number;
    summary: string;
    nested: { outer: string; inner: string; n_patients: number; n_outer_folds: number } | null;
  };
  targets: Record<Target, TargetMetrics>;
}
