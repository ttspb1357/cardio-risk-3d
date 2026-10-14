import { useEffect, useState } from "react";
import { api } from "../api";
import type { Prediction, Values } from "../types";

export type Route = "assess" | "validation" | "method";

function readRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  return h === "validation" || h === "method" ? h : "assess";
}

/** Tiny hash router: #/ (assessment), #/validation, #/method. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Live prediction for the current inputs: debounced, cancels stale requests, keeps the last result while loading. */
export function usePrediction(values: Values) {
  const [result, setResult] = useState<Prediction | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const t0 = performance.now();
      try {
        const r = await api.predict(values, ctrl.signal);
        setResult(r);
        setError(null);
        setLatency(performance.now() - t0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 110);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [values]);

  return { result, loading, error, latency };
}
