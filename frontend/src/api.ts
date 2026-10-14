import type { Metrics, Prediction, Sample, Schema, Values } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const body = await r.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  features: () => request<Schema>("/features"),
  samples: () => request<Sample[]>("/samples"),
  metrics: () => request<Metrics>("/metrics"),
  predict: (values: Values, signal?: AbortSignal) =>
    request<Prediction>("/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
      signal,
    }),
};
