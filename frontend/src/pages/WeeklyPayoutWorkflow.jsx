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
  const progress = ((activeStep + 1) / STEPS.length) * 100;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-indigo-500/15 via-slate-900/70 to-violet-500/15 p-5 shadow-xl shadow-black/20 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-slate-100">
            Weekly Payout Workflow
          </h1>
          <span className="rounded-full border border-indigo-300/35 bg-indigo-500/15 px-3 py-1 text-xs font-semibold tracking-wide text-indigo-200">
            STEP {activeStep + 1} OF {STEPS.length}
          </span>
        </div>
        <p className="mt-2 text-sm text-slate-300">
          Complete each step in sequence to generate the final weekly payout.
        </p>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-400 via-cyan-300 to-violet-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {STEPS.map((step, idx) => {
            const isActive = idx === activeStep;
            const isCompleted = idx < activeStep;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStep(idx)}
                className={`group rounded-xl border px-3 py-2 text-left text-sm transition ${
                  isActive
                    ? "border-indigo-300/60 bg-indigo-500/20 text-indigo-100 shadow-lg shadow-indigo-900/20"
                    : isCompleted
                      ? "border-emerald-300/50 bg-emerald-500/15 text-emerald-200"
                      : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      isActive
                        ? "bg-indigo-300/30 text-indigo-100"
                        : isCompleted
                          ? "bg-emerald-300/30 text-emerald-100"
                          : "bg-white/10 text-slate-300"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <span className="font-medium">{step.label}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-xl shadow-black/20 backdrop-blur ${
          activeStep === 0 ? "block" : "hidden"
        }`}
      >
        <DailyTips embedded stepTitle="Step 1 - Daily Tips" />
      </div>
      <div
        className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-xl shadow-black/20 backdrop-blur ${
          activeStep === 1 ? "block" : "hidden"
        }`}
      >
        <WeeklyTardiness embedded stepTitle="Step 2 - Weekly Tardiness" />
      </div>
      <div
        className={`rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-xl shadow-black/20 backdrop-blur ${
          activeStep === 2 ? "block" : "hidden"
        }`}
      >
        <WeeklyPayout embedded stepTitle="Step 3 - Weekly Payout" />
      </div>

      <div className="sticky bottom-4 z-40">
        <div className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-900/90 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur">
          <span className="text-xs font-medium uppercase tracking-widest text-slate-400">
            {STEPS[activeStep]?.label}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveStep((s) => Math.max(0, s - 1))}
              disabled={isFirst}
              className="rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 shadow-sm transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() =>
                setActiveStep((s) => Math.min(STEPS.length - 1, s + 1))
              }
              disabled={isLast}
              className="rounded-lg border border-indigo-300/40 bg-gradient-to-r from-indigo-500 to-violet-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next Step
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
