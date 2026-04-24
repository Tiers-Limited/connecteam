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
  const stepCurve = [
    { x: 14, y: 48 },
    { x: 50, y: 48 },
    { x: 86, y: 48 },
  ];
  const lineStartX = stepCurve[0].x;
  const lineEndX = stepCurve[stepCurve.length - 1].x;
  const activeX = stepCurve[activeStep]?.x ?? lineStartX;
  const filledLineWidth = Math.max(0, Math.min(lineEndX - lineStartX, activeX - lineStartX));
  const stepColors = {
    active: "from-indigo-500 to-violet-500 border-indigo-300/50 text-white",
    complete: "from-emerald-500 to-cyan-500 border-emerald-300/50 text-white",
    idle: "from-slate-700 to-slate-800 border-white/15 text-slate-100",
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-lg shadow-black/20 backdrop-blur">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-slate-100">
            Weekly Payout Workflow
          </h1>
          <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-slate-300">
            Step {activeStep + 1} / {STEPS.length}
          </span>
        </div>
        <div className="relative mt-4 h-[150px] w-full">
          <div
            className="absolute h-[2px] border-t-2 border-dashed border-slate-500/50"
            style={{
              left: `${lineStartX}%`,
              right: `${100 - lineEndX}%`,
              top: `${stepCurve[0].y}%`,
            }}
          />
          <div
            className="absolute h-[2px] border-t-2 border-dashed border-indigo-300 transition-all duration-300"
            style={{
              left: `${lineStartX}%`,
              top: `${stepCurve[0].y}%`,
              width: `${filledLineWidth}%`,
            }}
          />

          {STEPS.map((step, idx) => {
            const isActive = idx === activeStep;
            const isCompleted = idx < activeStep;
            const tone = isActive
              ? stepColors.active
              : isCompleted
                ? stepColors.complete
                : stepColors.idle;
            const pos = stepCurve[idx] ?? { x: 50, y: 50 };

            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStep(idx)}
                className="group absolute -translate-x-1/2 -translate-y-1/2 text-left"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <div
                  className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full border bg-gradient-to-br text-sm font-bold shadow-lg shadow-black/30 transition-transform group-hover:scale-105 ${tone}`}
                >
                  {idx + 1}
                </div>
                <p className="mt-2 whitespace-nowrap text-xs font-semibold tracking-wide text-slate-200">
                  {step.label}
                </p>
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
