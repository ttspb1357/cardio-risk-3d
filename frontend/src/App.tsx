import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Disclaimer, Splash, TopBar } from "./components/Chrome";
import { useHashRoute } from "./lib/hooks";
import { AssessPage } from "./pages/AssessPage";
import { MethodPage } from "./pages/MethodPage";
import { ValidationPage } from "./pages/ValidationPage";
import type { Metrics, Sample, Schema } from "./types";

interface Data {
  schema: Schema;
  samples: Sample[];
  metrics: Metrics;
}

export function App() {
  const route = useHashRoute();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.features(), api.samples(), api.metrics()])
      .then(([schema, samples, metrics]) => setData({ schema, samples, metrics }))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    // Braces matter: scrollTo() returns a Promise in newer browsers, and an effect may only return a cleanup function.
    window.scrollTo({ top: 0 });
  }, [route]);

  return (
    <div className="app">
      <div className="window">
        <div className="chrome">
          <Disclaimer />
          <TopBar route={route} />
        </div>
        <main className="main">
          {error ? <Splash error={error} /> : !data ? <Splash /> : (
            <>
              {/* The assessment page stays mounted so inputs and the 3D scene survive page switches. */}
              <div hidden={route !== "assess"}>
                <AssessPage schema={data.schema} samples={data.samples} />
              </div>
              <AnimatePresence mode="wait">
                {route !== "assess" && (
                  <motion.div key={route} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
                    {route === "validation" ? <ValidationPage metrics={data.metrics} schema={data.schema} /> : <MethodPage />}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
