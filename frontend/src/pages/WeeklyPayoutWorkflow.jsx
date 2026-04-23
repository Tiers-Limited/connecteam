import { useState } from "react";
import DailyTips from "./DailyTips";
import WeeklyTardiness from "./WeeklyTardiness";
import WeeklyPayout from "./WeeklyPayout";

const STEPS = [
  { id: "daily-tips", label: "Daily Tips" },
  { id: "weekly-tardiness", label: "Weekly Tardiness" },
  { id: "weekly-payout", label: "Weekly Payout" },
];

export default function WeeklyPayoutWorkflow() {
  const [activeStep, setActiveStep] = useState(0);
  const isFirst = activeStep === 0;
  const isLast = activeStep === STEPS.length - 1;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-800">
          Weekly Payout Workflow
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Complete the steps in order: save Daily Tips, load Weekly Tardiness,
          then load Weekly Payout.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {STEPS.map((step, idx) => {
            const isActive = idx === activeStep;
            const isCompleted = idx < activeStep;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStep(idx)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                  isActive
                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                    : isCompleted
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {idx + 1}. {step.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={activeStep === 0 ? "block" : "hidden"}>
        <DailyTips embedded />
      </div>
      <div className={activeStep === 1 ? "block" : "hidden"}>
        <WeeklyTardiness embedded />
      </div>
      <div className={activeStep === 2 ? "block" : "hidden"}>
        <WeeklyPayout embedded />
      </div>

      <div className="sticky bottom-4 z-40 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
          disabled={isFirst}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() =>
            setActiveStep((s) => Math.min(STEPS.length - 1, s + 1))
          }
          disabled={isLast}
          className="rounded-lg border border-indigo-300 bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
        >
          Next Step
        </button>
      </div>
    </div>
  );
}
