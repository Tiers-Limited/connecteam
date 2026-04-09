import { useEffect, useState, useCallback, useRef } from "react";
import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";
import {
  getDailyTipInput,
  getDailyTipCalculation,
  upsertDailyTipInput,
  upsertDailyTipAdjustment,
  getPendingDailyTips,
  calculateAllPendingDailyTips,
} from "../services/dailyTipService";
import {
  getManualWorkingByDate,
  upsertManualWorking,
  deleteManualWorking,
} from "../services/manualWorkingService";
import { toDateString } from "../utils/dateUtils";
import {
  splitWorkedHoursForLocation,
  formatClockLabel,
  toTimeInputValue,
} from "../utils/tipShiftUtils";
import { exportTableToCSV, exportTableToPDF } from "../utils/reportUtils";
import Button from "../components/ui/Button";

const PAGE_SIZES = [10, 25, 50, 100];
const PRODUCTION_POOL_PERCENT = 0.04;
const STORAGE_BREAKDOWN = "dailyTipsBreakdownContext";

function locationIsTheCove(loc) {
  return (loc?.name || "").trim().toLowerCase() === "the cove";
}

function rowDateYmd(row) {
  const raw = row?.date;
  if (!raw) return "";
  if (typeof raw === "string") return raw.slice(0, 10);
  try {
    return toDateString(new Date(raw));
  } catch {
    return "";
  }
}

function productionPoolAmount(amGross, pmGross) {
  const am = Number(amGross) || 0;
  const pm = Number(pmGross) || 0;
  return Math.round((am + pm) * PRODUCTION_POOL_PERCENT * 100) / 100;
}

/** DailyTipInput.createdBy* from API when tips were last saved. */
function tipAddedByLabel(row) {
  const name = (row?.createdByUsername || "").trim();
  const email = (row?.createdByEmail || "").trim();
  return name || email || "—";
}

function shiftDescriptionForLocation(locationName) {
  const n = (locationName || "").trim().toLowerCase();
  if (n === "the cove") {
    return " Enter gross tips for one combined shift (all hours counted, no AM/PM split). ";
  }
  if (n === "casa del mar" || n === "oranjestad") {
    return " Enter gross tips per shift (AM 06:00–14:00, PM 14:00–23:00). ";
  }
  return " Enter gross tips per shift (AM 06:00–15:00, PM 15:00–23:00). ";
}

export default function DailyTips() {
  const {
    selectedLocationId,
    locations,
    dailyTipsCache,
    setDailyTipsCache,
  } = useApp();
  const locationsRef = useRef(locations);
  useEffect(() => {
    locationsRef.current = locations;
  }, [locations]);
  const [saveLocationId, setSaveLocationId] = useState(null);
  const [saveDate, setSaveDate] = useState(
    () => dailyTipsCache?.date || toDateString(new Date()),
  );
  const [viewerLocationId, setViewerLocationId] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_BREAKDOWN);
      const p = raw ? JSON.parse(raw) : null;
      if (p?.locationId) return p.locationId;
    } catch {
      /* ignore */
    }
    return null;
  });
  const [viewerDate, setViewerDate] = useState(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_BREAKDOWN);
      const p = raw ? JSON.parse(raw) : null;
      if (p?.dateStr) return p.dateStr;
    } catch {
      /* ignore */
    }
    return dailyTipsCache?.date || toDateString(new Date());
  });
  /** Active breakdown target (set when user loads breakdown or opens a pending row). */
  const [breakdownView, setBreakdownView] = useState(null);
  const [pendingPage, setPendingPage] = useState(1);
  const pendingLimit = 25;
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingItems, setPendingItems] = useState([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [batchCalculating, setBatchCalculating] = useState(false);
  const [calculation, setCalculation] = useState(
    () => dailyTipsCache?.calculation ?? null,
  );
  const [calculationError, setCalculationError] = useState(
    () => dailyTipsCache?.calculationError ?? null,
  );
  const [loadingCalculation, setLoadingCalculation] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState("save");
  const [form, setForm] = useState(
    () => dailyTipsCache?.form || { amGrossTips: "", pmGrossTips: "" },
  );
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [hasExistingTipInput, setHasExistingTipInput] = useState(false);
  const [checkingExistingTipInput, setCheckingExistingTipInput] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustEmployee, setAdjustEmployee] = useState(null);
  const [adjustCashAdvance, setAdjustCashAdvance] = useState("");
  const [adjustRedistribute, setAdjustRedistribute] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [manualRows, setManualRows] = useState([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualForm, setManualForm] = useState({
    name: "",
    clockIn: "",
    clockOut: "",
  });
  const [manualRemoveRow, setManualRemoveRow] = useState(null);
  const [manualRemoveSaving, setManualRemoveSaving] = useState(false);
  /** Saved gross tips for active breakdown row (shown while calculation is loading). */
  const [breakdownSavedTips, setBreakdownSavedTips] = useState(null);

  const saveLocation = locations.find((l) => l._id === saveLocationId);
  const breakdownLocation = locations.find(
    (l) => l._id === breakdownView?.locationId,
  );
  const isSaveTheCove = locationIsTheCove(saveLocation);
  const isBreakdownTheCove = locationIsTheCove(breakdownLocation);

  useEffect(() => {
    try {
      if (breakdownView?.locationId && breakdownView?.dateStr) {
        sessionStorage.setItem(
          STORAGE_BREAKDOWN,
          JSON.stringify(breakdownView),
        );
      }
    } catch {
      /* ignore */
    }
  }, [breakdownView]);

  useEffect(() => {
    if (!locations?.length) return;
    setViewerLocationId((prev) => {
      if (prev && locations.some((l) => l._id === prev)) return prev;
      if (
        selectedLocationId &&
        locations.some((l) => l._id === selectedLocationId)
      )
        return selectedLocationId;
      return locations[0]._id;
    });
  }, [locations, selectedLocationId]);

  useEffect(() => {
    if (!locations?.length) return;
    setSaveLocationId((prev) => {
      if (prev && locations.some((l) => l._id === prev)) return prev;
      if (
        selectedLocationId &&
        locations.some((l) => l._id === selectedLocationId)
      )
        return selectedLocationId;
      return locations[0]._id;
    });
  }, [locations, selectedLocationId]);

  useEffect(() => {
    if (!saveLocationId || !saveDate || activeSubTab !== "save") {
      setHasExistingTipInput(false);
      return;
    }
    let cancelled = false;
    setCheckingExistingTipInput(true);
    getDailyTipInput(saveLocationId, saveDate)
      .then((tipInput) => {
        if (cancelled) return;
        if (!tipInput) {
          setHasExistingTipInput(false);
          setForm({ amGrossTips: "", pmGrossTips: "" });
          return;
        }
        const am = Number(tipInput.amGrossTips);
        const pm = Number(tipInput.pmGrossTips);
        setHasExistingTipInput(true);
        setForm({
          amGrossTips: Number.isFinite(am) ? String(am) : "",
          pmGrossTips: isSaveTheCove
            ? ""
            : Number.isFinite(pm)
              ? String(pm)
              : "",
        });
      })
      .catch(() => {
        if (!cancelled) {
          setHasExistingTipInput(false);
          setForm({ amGrossTips: "", pmGrossTips: "" });
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingExistingTipInput(false);
      });

    return () => {
      cancelled = true;
    };
  }, [saveLocationId, saveDate, activeSubTab, isSaveTheCove]);

  const loadPending = useCallback(
    async (pageOverride) => {
      const page =
        typeof pageOverride === "number" ? pageOverride : pendingPage;
      setLoadingPending(true);
      try {
        const data = await getPendingDailyTips(page, pendingLimit);
        setPendingItems(data.items ?? []);
        setPendingTotal(Number(data.total) || 0);
      } catch {
        toast.error("Failed to load pending tips");
        setPendingItems([]);
        setPendingTotal(0);
      } finally {
        setLoadingPending(false);
      }
    },
    [pendingPage, pendingLimit],
  );

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const refreshBreakdownCalculation = useCallback(
    async (silent = false, override, forceRefresh = false) => {
      const locationId = override?.locationId ?? breakdownView?.locationId;
      const dateStr = override?.dateStr ?? breakdownView?.dateStr;
      if (!locationId || !dateStr) return;
      if (!silent) setLoadingCalculation(true);
      setCalculationError(null);
      try {
        const tipInput = await getDailyTipInput(locationId, dateStr).catch(
          () => null,
        );
        const bdLoc = locationsRef.current.find((l) => l._id === locationId);
        const bdCove = locationIsTheCove(bdLoc);
        if (!tipInput) {
          setBreakdownSavedTips(null);
          setCalculation(null);
          setCalculationError(
            "No saved tips for this location and date. Use Save tips first.",
          );
          setDailyTipsCache((prev) => ({
            ...prev,
            locationId,
            date: dateStr,
            calculation: null,
            calculationError:
              "No saved tips for this location and date. Use Save tips first.",
          }));
          return;
        }
        setBreakdownSavedTips({
          amGrossTips: tipInput.amGrossTips,
          pmGrossTips: tipInput.pmGrossTips,
        });
        const calc = await getDailyTipCalculation(locationId, dateStr, {
          refresh: forceRefresh,
        }).catch(() => ({ error: "Failed to load calculation" }));
        if (calc?.error) {
          setCalculation(null);
          setCalculationError(calc.error);
        } else {
          setCalculation(calc || null);
          setCalculationError(null);
          await loadPending();
        }
        setDailyTipsCache((prev) => ({
          ...prev,
          locationId,
          date: dateStr,
          form: {
            amGrossTips: String(tipInput.amGrossTips),
            pmGrossTips: bdCove ? "" : String(tipInput.pmGrossTips),
          },
          calculation: calc?.error ? null : calc || null,
          calculationError: calc?.error || null,
        }));
      } catch {
        setCalculation(null);
        setCalculationError("Failed to load calculation");
      } finally {
        if (!silent) setLoadingCalculation(false);
      }
    },
    [breakdownView, setDailyTipsCache, loadPending],
  );

  useEffect(() => {
    if (activeSubTab !== "save") return;
    setCalculation(null);
    setCalculationError(null);
    setDailyTipsCache((prev) => ({
      ...prev,
      calculation: null,
      calculationError: null,
    }));
  }, [activeSubTab, setDailyTipsCache]);

  useEffect(() => {
    if (!breakdownView?.locationId || activeSubTab !== "breakdown") return;
    setManualLoading(true);
    getManualWorkingByDate(breakdownView.locationId, breakdownView.dateStr)
      .then(setManualRows)
      .catch(() => setManualRows([]))
      .finally(() => setManualLoading(false));
  }, [breakdownView, activeSubTab]);

  useEffect(() => {
    if (!breakdownView?.locationId || activeSubTab !== "breakdown") {
      setBreakdownSavedTips(null);
      return;
    }
    let cancelled = false;
    getDailyTipInput(breakdownView.locationId, breakdownView.dateStr)
      .then((input) => {
        if (cancelled) return;
        if (input) {
          setBreakdownSavedTips({
            amGrossTips: input.amGrossTips,
            pmGrossTips: input.pmGrossTips,
          });
        } else {
          setBreakdownSavedTips(null);
        }
      })
      .catch(() => {
        if (!cancelled) setBreakdownSavedTips(null);
      });
    return () => {
      cancelled = true;
    };
  }, [breakdownView?.locationId, breakdownView?.dateStr, activeSubTab]);

  const handleCalculateAllPending = useCallback(async () => {
    setBatchCalculating(true);
    try {
      const data = await calculateAllPendingDailyTips(25);
      const ok = data.succeeded ?? 0;
      const bad = data.failed ?? 0;
      toast.success(
        `Calculated ${ok} of ${data.attempted ?? 0}. ${bad > 0 ? `${bad} failed — check messages.` : ""}`,
      );
      if (data.results?.length && bad > 0) {
        const firstErr = data.results.find((r) => !r.ok && r.error);
        if (firstErr?.error) toast.error(String(firstErr.error).slice(0, 120));
      }
      setPendingPage(1);
      await loadPending(1);
    } catch (err) {
      toast.error(
        err.response?.data?.message || err.message || "Batch calculation failed",
      );
    } finally {
      setBatchCalculating(false);
    }
  }, [loadPending]);

  useEffect(() => {
    if (!manualRemoveRow) return;
    const onEscape = (e) => {
      if (e.key === "Escape") setManualRemoveRow(null);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [manualRemoveRow]);

  const confirmRemoveManual = useCallback(async () => {
    if (!manualRemoveRow?._id) return;
    setManualRemoveSaving(true);
    try {
      await deleteManualWorking(manualRemoveRow._id);
      toast.success("Removed");
      const removedId = manualRemoveRow._id;
      setManualRemoveRow(null);
      setManualRows((prev) => prev.filter((r) => r._id !== removedId));
      await loadPending();
      if (activeSubTab === "breakdown")
        await refreshBreakdownCalculation(false, undefined, true);
    } catch (err) {
      toast.error(
        err.response?.data?.error || err.message || "Failed to delete",
      );
    } finally {
      setManualRemoveSaving(false);
    }
  }, [
    manualRemoveRow,
    loadPending,
    refreshBreakdownCalculation,
    activeSubTab,
  ]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!saveLocationId) {
      toast.error("Select a location");
      return;
    }
    const am = parseFloat(form.amGrossTips);
    const pm = isSaveTheCove ? 0 : parseFloat(form.pmGrossTips);
    if (isNaN(am) || am < 0) {
      setFormErrors({ amGrossTips: "Enter a valid amount ≥ 0" });
      toast.error("AM gross tips must be ≥ 0");
      return;
    }
    if (!isSaveTheCove && (form.pmGrossTips === "" || isNaN(pm) || pm < 0)) {
      setFormErrors({ pmGrossTips: "Enter a valid amount ≥ 0" });
      toast.error("PM gross tips must be ≥ 0");
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      await upsertDailyTipInput(saveLocationId, saveDate, {
        amGrossTips: am,
        pmGrossTips: pm,
      });
      toast.success(
        hasExistingTipInput
          ? "Tips updated. Run calculation to refresh employee split."
          : "Tips saved. Production pool uses 4% of gross from saved data.",
      );
      setCalculation(null);
      setCalculationError(null);
      setDailyTipsCache((prev) => ({
        ...prev,
        locationId: saveLocationId,
        date: saveDate,
        form: { amGrossTips: String(am), pmGrossTips: String(pm) },
        calculation: null,
        calculationError: null,
      }));
      setHasExistingTipInput(true);
      setPendingPage(1);
      await loadPending(1);
    } catch (err) {
      const details = err.response?.data?.details;
      if (details && Array.isArray(details)) {
        const fieldErrors = {};
        details.forEach((d) => {
          if (d.field) fieldErrors[d.field] = d.message;
        });
        setFormErrors(fieldErrors);
        details.forEach((d) => toast.error(d.message));
      }
    } finally {
      setSaving(false);
    }
  };

  const allocations = (calculation?.employeeAllocations ?? [])
    .slice()
    .sort((a, b) =>
      (a.employeeName || "").localeCompare(b.employeeName || "", undefined, {
        sensitivity: "base",
      }),
    );
  const totalRows = allocations.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const pageAllocations = allocations.slice(startIdx, startIdx + pageSize);

  const totals =
    totalRows > 0
      ? allocations.reduce(
          (acc, a) => ({
            amWorkedHours: acc.amWorkedHours + (Number(a.amWorkedHours) || 0),
            pmWorkedHours: acc.pmWorkedHours + (Number(a.pmWorkedHours) || 0),
            amTips: acc.amTips + (Number(a.amTips) || 0),
            pmTips: acc.pmTips + (Number(a.pmTips) || 0),
            totalTips:
              acc.totalTips + (Number(a.finalTips ?? a.totalTips) || 0),
          }),
          {
            amWorkedHours: 0,
            pmWorkedHours: 0,
            amTips: 0,
            pmTips: 0,
            totalTips: 0,
          },
        )
      : null;

  const openAdjustModal = useCallback(
    (row) => {
      setAdjustEmployee(row);
      setAdjustCashAdvance(
        String(row.cashAdvanceDeduction ?? 0),
      );
      setAdjustRedistribute(
        String(row.redistributeDeduction ?? 0),
      );
      setAdjustModalOpen(true);
    },
    [],
  );

  const saveAdjustments = useCallback(async () => {
    const lid = breakdownView?.locationId;
    const ds = breakdownView?.dateStr;
    if (!lid || !ds || !adjustEmployee?.employeeId) return;
    const cashAdvance = Math.max(0, parseFloat(adjustCashAdvance || "0") || 0);
    const redistribute = Math.max(0, parseFloat(adjustRedistribute || "0") || 0);
    setAdjustSaving(true);
    try {
      await Promise.all([
        upsertDailyTipAdjustment(lid, ds, {
          employeeId: adjustEmployee.employeeId,
          type: "cash_advance",
          amount: cashAdvance,
          reason: "",
        }),
        upsertDailyTipAdjustment(lid, ds, {
          employeeId: adjustEmployee.employeeId,
          type: "redistribute_equal",
          amount: redistribute,
          reason: "",
        }),
      ]);
      toast.success("Adjustments saved. Recalculating…");
      await refreshBreakdownCalculation(false, undefined, true);
      setAdjustModalOpen(false);
    } catch (_e) {
      toast.error("Failed to save adjustments");
    } finally {
      setAdjustSaving(false);
    }
  }, [
    breakdownView,
    adjustEmployee,
    adjustCashAdvance,
    adjustRedistribute,
    refreshBreakdownCalculation,
  ]);

  const showShiftSplit = !isBreakdownTheCove;

  const spinner = (
    <svg
      className="mr-2 h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  if (!locations?.length) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800">Daily Tips</h1>
        <div className="rounded-xl border border-slate-200 bg-transparent p-5 shadow-sm">
          <p className="text-slate-600">Loading locations…</p>
        </div>
      </div>
    );
  }

  const draftAm =
    form.amGrossTips !== "" ? parseFloat(form.amGrossTips) : NaN;
  const draftPm =
    form.pmGrossTips !== "" ? parseFloat(form.pmGrossTips) : NaN;
  const draftTotal =
    (Number.isFinite(draftAm) && draftAm >= 0 ? draftAm : 0) +
    (isSaveTheCove
      ? 0
      : Number.isFinite(draftPm) && draftPm >= 0
        ? draftPm
        : 0);
  const productionDeductionDollars =
    calculation?.inputs != null && activeSubTab === "breakdown"
      ? (Number(calculation.inputs.productionDeductionAM) || 0) +
        (Number(calculation.inputs.productionDeductionPM) || 0)
      : draftTotal > 0
        ? productionPoolAmount(
            Number.isFinite(draftAm) && draftAm >= 0 ? draftAm : 0,
            isSaveTheCove
              ? 0
              : Number.isFinite(draftPm) && draftPm >= 0
                ? draftPm
                : 0,
          )
        : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Daily Tips</h1>
      <p className="text-slate-600">
        {shiftDescriptionForLocation(saveLocation?.name)}
        Choose location and date in the form, enter gross tips, and save.{" "}
        <strong className="text-slate-800">4% of gross</strong> counts toward
        the production pool as soon as tips are saved. The table lists only
        days that still need a calculation; after a successful run they leave
        this list. Use <strong>Calculate all pending</strong> to process up to
        25 at once. Open <strong>Breakdown</strong> to pick any location and
        date and load the employee split.
        {productionDeductionDollars != null && (
          <span className="text-slate-800">
            {" "}
            Estimated 4% from amounts in the form:{" "}
            <strong>${productionDeductionDollars.toFixed(2)}</strong>.
          </span>
        )}
      </p>

      <div className="flex gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveSubTab("save")}
          className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            activeSubTab === "save"
              ? "border border-b-0 border-slate-200 bg-white text-slate-900"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Save tips
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("breakdown")}
          className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            activeSubTab === "breakdown"
              ? "border border-b-0 border-slate-200 bg-white text-slate-900"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Breakdown
        </button>
      </div>

      {activeSubTab === "save" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 border-t-0 bg-white px-4 py-4 shadow-sm sm:border-t sm:rounded-t-none">
            <form
              onSubmit={handleSubmit}
              className="flex flex-wrap items-end gap-4"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Location
                </label>
                <select
                  value={saveLocationId || ""}
                  onChange={(e) => setSaveLocationId(e.target.value || null)}
                  className="min-w-[160px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  {locations.map((loc) => (
                    <option key={loc._id} value={loc._id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Date
                </label>
                <input
                  type="date"
                  value={saveDate}
                  onChange={(e) => setSaveDate(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  {isSaveTheCove ? "Gross Tips ($)" : "AM Gross Tips ($)"}
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.amGrossTips}
                  onChange={(e) =>
                    setForm({ ...form, amGrossTips: e.target.value })
                  }
                  className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  placeholder="0"
                />
                {formErrors.amGrossTips && (
                  <p className="mt-0.5 text-xs text-red-600">
                    {formErrors.amGrossTips}
                  </p>
                )}
              </div>
              {!isSaveTheCove && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    PM Gross Tips ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.pmGrossTips}
                    onChange={(e) =>
                      setForm({ ...form, pmGrossTips: e.target.value })
                    }
                    className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    placeholder="0"
                  />
                  {formErrors.pmGrossTips && (
                    <p className="mt-0.5 text-xs text-red-600">
                      {formErrors.pmGrossTips}
                    </p>
                  )}
                </div>
              )}
              <Button type="submit" disabled={saving || !saveLocationId}>
                {saving ? (
                  <>{spinner}{hasExistingTipInput ? "Updating…" : "Saving…"}</>
                ) : hasExistingTipInput ? (
                  "Update"
                ) : (
                  "Save"
                )}
              </Button>
              {checkingExistingTipInput ? (
                <span className="text-xs text-slate-500">
                  Checking existing tips…
                </span>
              ) : null}
            </form>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-700">
                Awaiting calculation (saved tips not yet calculated)
              </h2>
              <Button
                type="button"
                variant="secondary"
                disabled={batchCalculating || pendingTotal === 0}
                onClick={() => void handleCalculateAllPending()}
              >
                {batchCalculating ? (
                  <>{spinner}Calculating…</>
                ) : (
                  "Calculate all pending (max 25)"
                )}
              </Button>
            </div>
            {loadingPending ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : pendingItems.length === 0 ? (
              <p className="text-sm text-slate-500">
                None pending — either nothing saved yet, or every saved day has
                been calculated. Edit saved tips to recalculate.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left">
                        <th className="pb-2 font-medium text-slate-700">
                          Date
                        </th>
                        <th className="pb-2 font-medium text-slate-700">
                          Location
                        </th>
                        <th className="pb-2 font-medium text-slate-700">
                          Added by
                        </th>
                        <th className="pb-2 text-right font-medium text-slate-700">
                          AM gross ($)
                        </th>
                        <th className="pb-2 text-right font-medium text-slate-700">
                          PM gross ($)
                        </th>
                        <th className="pb-2 text-right font-medium text-slate-700">
                          4% pool ($)
                        </th>
                        <th className="pb-2 text-right font-medium text-slate-700">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pendingItems.map((row) => {
                        const loc =
                          typeof row.locationId === "object"
                            ? row.locationId
                            : null;
                        const locId =
                          typeof row.locationId === "object"
                            ? row.locationId?._id
                            : row.locationId;
                        const rowCove = locationIsTheCove(loc);
                        const ymd = rowDateYmd(row);
                        return (
                          <tr key={row._id}>
                            <td className="py-2.5 font-medium text-slate-800">
                              {ymd}
                            </td>
                            <td className="py-2.5 text-slate-700">
                              {loc?.name ?? "—"}
                            </td>
                            <td className="py-2.5 text-slate-700">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-slate-800">
                                  {tipAddedByLabel(row)}
                                </span>
                                {(row.createdByRole || "").trim() ? (
                                  <span className="text-xs capitalize text-slate-500">
                                    {String(row.createdByRole).trim()}
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-slate-800">
                              {Number(row.amGrossTips).toFixed(2)}
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-slate-600">
                              {rowCove ? "—" : Number(row.pmGrossTips).toFixed(2)}
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-slate-800">
                              $
                              {productionPoolAmount(
                                row.amGrossTips,
                                row.pmGrossTips,
                              ).toFixed(2)}
                            </td>
                            <td className="py-2.5 text-right">
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => {
                                  if (!locId || !ymd) return;
                                  const id = String(locId);
                                  setViewerLocationId(id);
                                  setViewerDate(ymd);
                                  setBreakdownView({
                                    locationId: id,
                                    dateStr: ymd,
                                  });
                                  setActiveSubTab("breakdown");
                                  void refreshBreakdownCalculation(false, {
                                    locationId: id,
                                    dateStr: ymd,
                                  }, true);
                                }}
                                disabled={loadingCalculation}
                              >
                                Load calculation
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
                  <span>
                    Page {pendingPage} of{" "}
                    {Math.max(1, Math.ceil(pendingTotal / pendingLimit))} (
                    {pendingTotal} pending)
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pendingPage <= 1}
                      onClick={() =>
                        setPendingPage((p) => Math.max(1, p - 1))
                      }
                    >
                      Previous
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pendingPage * pendingLimit >= pendingTotal}
                      onClick={() => setPendingPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeSubTab === "breakdown" && (
        <div className="space-y-4 rounded-lg border border-slate-200 border-t-0 bg-white px-4 py-4 shadow-sm sm:border-t sm:rounded-t-none">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-4">
            <p className="text-sm text-slate-600">
              Select a location and date, then load the employee breakdown. You
              can view any day that has saved tips (including after it left the
              pending list).
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Location
                </label>
                <select
                  value={viewerLocationId || ""}
                  onChange={(e) => setViewerLocationId(e.target.value || null)}
                  className="min-w-[160px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  {locations.map((loc) => (
                    <option key={loc._id} value={loc._id}>
                      {loc.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Date
                </label>
                <input
                  type="date"
                  value={viewerDate}
                  onChange={(e) => setViewerDate(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                />
              </div>
              <Button
                type="button"
                disabled={!viewerLocationId || !viewerDate || loadingCalculation}
                onClick={() => {
                  if (!viewerLocationId || !viewerDate) return;
                  const v = {
                    locationId: viewerLocationId,
                    dateStr: viewerDate,
                  };
                  setBreakdownView(v);
                  void refreshBreakdownCalculation(false, v);
                }}
              >
                Load breakdown
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => refreshBreakdownCalculation(false, undefined, true)}
                disabled={
                  loadingCalculation ||
                  !breakdownView?.locationId ||
                  !breakdownView?.dateStr
                }
              >
                {loadingCalculation ? (
                  <>{spinner}Loading…</>
                ) : (
                  "Refresh calculation"
                )}
              </Button>
            </div>
            {breakdownView?.locationId && (
              <p className="text-xs text-slate-500">
                Active row:{" "}
                <strong className="text-slate-700">
                  {breakdownLocation?.name ?? "—"}
                </strong>{" "}
                — {breakdownView.dateStr}
              </p>
            )}
            {breakdownView?.locationId && (
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm">
                {loadingCalculation && !breakdownSavedTips ? (
                  <span className="flex items-center gap-2 text-slate-600">
                    {spinner}
                    Loading saved gross tips…
                  </span>
                ) : breakdownSavedTips ? (
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-slate-700">
                    <span className="font-semibold text-slate-800">
                      Saved gross tips
                    </span>
                    {isBreakdownTheCove ? (
                      <span className="tabular-nums">
                        Gross:{" "}
                        <strong>
                          $
                          {Number(
                            breakdownSavedTips.amGrossTips,
                          ).toFixed(2)}
                        </strong>
                      </span>
                    ) : (
                      <>
                        <span className="tabular-nums">
                          AM:{" "}
                          <strong>
                            $
                            {Number(
                              breakdownSavedTips.amGrossTips,
                            ).toFixed(2)}
                          </strong>
                        </span>
                        <span className="tabular-nums">
                          PM:{" "}
                          <strong>
                            $
                            {Number(
                              breakdownSavedTips.pmGrossTips,
                            ).toFixed(2)}
                          </strong>
                        </span>
                      </>
                    )}
                    {loadingCalculation && (
                      <span className="flex items-center gap-2 text-slate-500">
                        {spinner}
                        Calculating employee split…
                      </span>
                    )}
                  </div>
                ) : (
                  !loadingCalculation && (
                    <span className="text-amber-800">
                      No saved gross tips for this location and date.
                    </span>
                  )
                )}
              </div>
            )}
          </div>

          {!breakdownView?.locationId && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
              Choose location and date above, then click{" "}
              <strong>Load breakdown</strong>. Or use{" "}
              <strong>Load calculation</strong> on a pending row under Save tips.
            </div>
          )}

          {breakdownView?.locationId && (
            <>
          <div className="rounded-lg border border-slate-200 bg-slate-50/40 px-4 py-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">
              Manual employees (not from Connecteam)
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              Add clock in and clock out for this location and date. AM/PM hours
              are derived using the same shift windows as Connecteam. They count
              toward the tip split after you run{" "}
              <strong>Refresh calculation</strong>.
            </p>
            <form
              className="mb-4 flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = manualForm.name.trim();
                if (!name) {
                  toast.error("Enter employee name");
                  return;
                }
                const cin = manualForm.clockIn?.trim();
                const cout = manualForm.clockOut?.trim();
                if (!cin || !cout) {
                  toast.error("Enter clock in and clock out");
                  return;
                }
                if (!breakdownView?.locationId || !breakdownView?.dateStr) {
                  toast.error("Load breakdown first (location + date)");
                  return;
                }
                setManualSaving(true);
                try {
                  await upsertManualWorking({
                    employeeName: name,
                    locationId: breakdownView.locationId,
                    date: breakdownView.dateStr,
                    clockIn: cin,
                    clockOut: cout,
                    amTips: 0,
                    pmTips: 0,
                  });
                  toast.success("Manual hours saved");
                  setManualForm({ name: "", clockIn: "", clockOut: "" });
                  const list = await getManualWorkingByDate(
                    breakdownView.locationId,
                    breakdownView.dateStr,
                  );
                  setManualRows(list);
                  await refreshBreakdownCalculation(false, undefined, true);
                } catch (err) {
                  toast.error(
                    err.response?.data?.error ||
                      err.message ||
                      "Failed to save manual hours",
                  );
                } finally {
                  setManualSaving(false);
                }
              }}
            >
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Name
            </label>
            <input
              type="text"
              value={manualForm.name}
              onChange={(e) =>
                setManualForm((f) => ({ ...f, name: e.target.value }))
              }
              className="min-w-[160px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              placeholder="Employee name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Clock in
            </label>
            <input
              type="time"
              value={toTimeInputValue(manualForm.clockIn)}
              onChange={(e) =>
                setManualForm((f) => ({ ...f, clockIn: e.target.value }))
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Clock out
            </label>
            <input
              type="time"
              value={toTimeInputValue(manualForm.clockOut)}
              onChange={(e) =>
                setManualForm((f) => ({ ...f, clockOut: e.target.value }))
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </div>
          <Button type="submit" disabled={manualSaving}>
            {manualSaving ? "Saving…" : "Add / update"}
          </Button>
        </form>
            {manualForm.clockIn &&
              manualForm.clockOut &&
              breakdownLocation?.name && (
                <p className="mb-4 text-xs text-slate-600">
                  {(() => {
                    const { amHours, pmHours } = splitWorkedHoursForLocation(
                      manualForm.clockIn,
                      manualForm.clockOut,
                      breakdownLocation.name,
                    );
                    const total = amHours + pmHours;
                    if (total <= 0) {
                      return (
                        <span className="text-amber-700">
                          Clock out must be after clock in.
                        </span>
                      );
                    }
                    return isBreakdownTheCove ? (
                      <>
                        Calculated hours:{" "}
                        <strong className="tabular-nums">
                          {(amHours + pmHours).toFixed(2)} h
                        </strong>{" "}
                        (single shift)
                      </>
                    ) : (
                      <>
                        Calculated split: AM{" "}
                        <strong className="tabular-nums">
                          {amHours.toFixed(2)} h
                        </strong>
                        , PM{" "}
                        <strong className="tabular-nums">
                          {pmHours.toFixed(2)} h
                        </strong>
                      </>
                    );
                  })()}
                </p>
              )}
        {manualLoading ? (
          <p className="text-sm text-slate-500">Loading manual entries…</p>
        ) : manualRows.length === 0 ? (
          <p className="text-sm text-slate-500">No manual entries for this date.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="pb-2 font-medium text-slate-700">Employee</th>
                  <th className="pb-2 font-medium text-slate-700">
                    Clock in
                  </th>
                  <th className="pb-2 font-medium text-slate-700">
                    Clock out
                  </th>
                  {isBreakdownTheCove ? (
                    <th className="pb-2 text-right font-medium text-slate-700">
                      Hours
                    </th>
                  ) : (
                    <>
                      <th className="pb-2 text-right font-medium text-slate-700">
                        AM hrs
                      </th>
                      <th className="pb-2 text-right font-medium text-slate-700">
                        PM hrs
                      </th>
                    </>
                  )}
                  <th className="pb-2 text-right font-medium text-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {manualRows.map((row) => {
                  const emp = row.employeeId;
                  const empName =
                    typeof emp === "object" && emp?.name
                      ? emp.name
                      : "—";
                  const am = Number(row.amHours) || 0;
                  const pm = Number(row.pmHours) || 0;
                  return (
                    <tr key={row._id}>
                      <td className="py-2 font-medium text-slate-800">
                        {empName}
                      </td>
                      <td className="py-2 tabular-nums text-slate-600">
                        {formatClockLabel(row.clockIn)}
                      </td>
                      <td className="py-2 tabular-nums text-slate-600">
                        {formatClockLabel(row.clockOut)}
                      </td>
                      {isBreakdownTheCove ? (
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          {(am + pm).toFixed(2)}
                        </td>
                      ) : (
                        <>
                          <td className="py-2 text-right tabular-nums text-slate-600">
                            {am.toFixed(2)}
                          </td>
                          <td className="py-2 text-right tabular-nums text-slate-600">
                            {pm.toFixed(2)}
                          </td>
                        </>
                      )}
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          className="text-xs font-medium text-red-600 hover:text-red-700"
                          onClick={() => setManualRemoveRow(row)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {calculationError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
          <p className="text-amber-700">{calculationError}</p>
          <p className="mt-1 text-sm text-slate-500">
            Enter AM and PM gross tips, click Save, then Load calculation. Clock
            data is loaded from Connecteam for this date; if Connecteam is
            unavailable, previously synced time entries are used when available.
          </p>
        </div>
      )}

      {calculation && !calculationError && (
        <div className="rounded-xl border border-slate-200 bg-transparent p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-slate-700">
            Daily calculation (audit)
          </h2>

          {calculation.inputs?.redistributionPool > 0 && (
            <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-700">
              Redistribution pool:{" "}
              <strong className="text-indigo-900">
                ${Number(calculation.inputs.redistributionPool).toFixed(2)}
              </strong>{" "}
              (deducted from selected employee(s) and redistributed equally to others)
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <span>
                4% production pool:{" "}
                <strong className="text-slate-800">
                  ${productionDeductionDollars?.toFixed(2) ?? "0.00"}
                </strong>
              </span>
              {isBreakdownTheCove ? (
                <>
                  <span>
                    Distributable: $
                    {calculation.inputs?.distributableAM?.toFixed(2)}
                  </span>
                  <span>
                    Tip rate: ${calculation.totals?.amTipRate?.toFixed(2)}/hr
                  </span>
                </>
              ) : (
                <>
                  <span>
                    AM distributable: $
                    {calculation.inputs?.distributableAM?.toFixed(2)}
                  </span>
                  <span>
                    PM distributable: $
                    {calculation.inputs?.distributablePM?.toFixed(2)}
                  </span>
                  <span>
                    AM tip rate: ${calculation.totals?.amTipRate?.toFixed(2)}/hr
                  </span>
                  <span>
                    PM tip rate: ${calculation.totals?.pmTipRate?.toFixed(2)}/hr
                  </span>
                </>
              )}
            </div>
            {totalRows > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-slate-500">
                  {totalRows} employee{totalRows !== 1 ? "s" : ""}
                </span>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  Rows per page
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800"
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
                  <span className="text-xs font-medium text-slate-500">
                    Report:
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const headers = [
                        "Employee",
                        "Clock In",
                        "Clock Out",
                        "AM hrs",
                        "PM hrs",
                        "AM tips",
                        "PM tips",
                        "Total",
                      ];
                      const rows = allocations.map((a) => [
                        a.employeeName ?? "",
                        a.clockIn ?? "–",
                        a.clockOut ?? "–",
                        a.amWorkedHours?.toFixed(2) ?? "",
                        a.pmWorkedHours?.toFixed(2) ?? "",
                        a.amTips != null
                          ? `$${Number(a.amTips).toFixed(2)}`
                          : "",
                        a.pmTips != null
                          ? `$${Number(a.pmTips).toFixed(2)}`
                          : "",
                        (a.finalTips ?? a.totalTips) != null
                          ? `$${Number(a.finalTips ?? a.totalTips).toFixed(2)}`
                          : "",
                      ]);
                      if (totals) {
                        rows.push([
                          "Total",
                          "",
                          "",
                          totals.amWorkedHours.toFixed(2),
                          totals.pmWorkedHours.toFixed(2),
                          `$${totals.amTips.toFixed(2)}`,
                          `$${totals.pmTips.toFixed(2)}`,
                          `$${totals.totalTips.toFixed(2)}`,
                        ]);
                      }
                      exportTableToCSV(
                        headers,
                        rows,
                        `daily-tips-${breakdownView?.dateStr ?? "export"}.csv`,
                      );
                    }}
                  >
                    Export CSV
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const headers = [
                        "Employee",
                        "Clock In",
                        "Clock Out",
                        "AM hrs",
                        "PM hrs",
                        "AM tips",
                        "PM tips",
                        "Total",
                      ];
                      const rows = allocations.map((a) => [
                        a.employeeName ?? "",
                        a.clockIn ?? "–",
                        a.clockOut ?? "–",
                        a.amWorkedHours?.toFixed(2) ?? "",
                        a.pmWorkedHours?.toFixed(2) ?? "",
                        a.amTips != null
                          ? `$${Number(a.amTips).toFixed(2)}`
                          : "",
                        a.pmTips != null
                          ? `$${Number(a.pmTips).toFixed(2)}`
                          : "",
                        (a.finalTips ?? a.totalTips) != null
                          ? `$${Number(a.finalTips ?? a.totalTips).toFixed(2)}`
                          : "",
                      ]);
                      if (totals) {
                        rows.push([
                          "Total",
                          "",
                          "",
                          totals.amWorkedHours.toFixed(2),
                          totals.pmWorkedHours.toFixed(2),
                          `$${totals.amTips.toFixed(2)}`,
                          `$${totals.pmTips.toFixed(2)}`,
                          `$${totals.totalTips.toFixed(2)}`,
                        ]);
                      }
                      exportTableToPDF(
                        `Daily Tips — ${breakdownLocation?.name ?? ""} — ${breakdownView?.dateStr ?? ""}`,
                        headers,
                        rows,
                        `daily-tips-${breakdownView?.dateStr ?? "export"}.pdf`,
                      );
                    }}
                  >
                    Export PDF
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="pb-2 text-left font-medium text-slate-700">
                    Employee
                  </th>
                  <th className="pb-2 text-left font-medium text-slate-700">
                    Clock In
                  </th>
                  <th className="pb-2 text-left font-medium text-slate-700">
                    Clock Out
                  </th>
                  {showShiftSplit ? (
                    <>
                      <th className="pb-2 text-right font-medium text-slate-700">
                        AM hrs
                      </th>
                      <th className="pb-2 text-right font-medium text-slate-700">
                        PM hrs
                      </th>
                      <th className="pb-2 text-right font-medium text-slate-700">
                        AM tips
                      </th>
                      <th className="pb-2 text-right font-medium text-slate-700">
                        PM tips
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="pb-2 text-right font-medium text-slate-700">
                        Hours
                      </th>
                      <th className="pb-2 text-right font-medium text-slate-700">
                        Tips
                      </th>
                    </>
                  )}
                  <th className="pb-2 text-right font-medium text-slate-700">
                    Total
                  </th>
                  <th className="pb-2 text-right font-medium text-slate-700">
                    Adjust
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageAllocations.map((a) => (
                  <tr
                    key={a.employeeId ?? a.employeeName}
                    className="hover:bg-slate-50"
                  >
                    <td className="py-2 font-medium text-slate-800">
                      {a.employeeName}
                    </td>
                    <td className="py-2 tabular-nums text-slate-600">
                      {formatClockLabel(a.clockIn)}
                    </td>
                    <td className="py-2 tabular-nums text-slate-600">
                      {formatClockLabel(a.clockOut)}
                    </td>
                    {showShiftSplit ? (
                      <>
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          {a.amWorkedHours?.toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          {a.pmWorkedHours?.toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          ${a.amTips?.toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          ${a.pmTips?.toFixed(2)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          {a.amWorkedHours?.toFixed(2)}
                        </td>
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          ${a.amTips?.toFixed(2)}
                        </td>
                      </>
                    )}
                    <td className="py-2 text-right font-medium tabular-nums text-slate-800">
                      ${(a.finalTips ?? a.totalTips)?.toFixed(2)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => openAdjustModal(a)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        title="Cash advance & redistribute adjustments"
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="border-t-2 border-slate-300">
                  <tr className="bg-slate-100 font-semibold">
                    <td className="py-3 pl-2 text-slate-800">Total</td>
                    <td className="py-3" colSpan={2} />
                    {showShiftSplit ? (
                      <>
                        <td className="py-3 text-right tabular-nums text-slate-800">
                          {totals.amWorkedHours.toFixed(2)}
                        </td>
                        <td className="py-3 text-right tabular-nums text-slate-800">
                          {totals.pmWorkedHours.toFixed(2)}
                        </td>
                        <td className="py-3 text-right tabular-nums text-slate-800">
                          ${totals.amTips.toFixed(2)}
                        </td>
                        <td className="py-3 text-right tabular-nums text-slate-800">
                          ${totals.pmTips.toFixed(2)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-3 text-right tabular-nums text-slate-800">
                          {totals.amWorkedHours.toFixed(2)}
                        </td>
                        <td className="py-3 text-right tabular-nums text-slate-800">
                          ${totals.amTips.toFixed(2)}
                        </td>
                      </>
                    )}
                    <td className="py-3 text-right tabular-nums text-slate-800">
                      ${totals.totalTips.toFixed(2)}
                    </td>
                    <td className="py-3" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {totals && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3">
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Totals
              </p>
              <div className="flex flex-wrap gap-6 text-sm text-slate-600">
                {showShiftSplit ? (
                  <>
                    <span>
                      AM hours:{" "}
                      <strong className="text-slate-800">
                        {totals.amWorkedHours.toFixed(2)}
                      </strong>
                    </span>
                    <span>
                      PM hours:{" "}
                      <strong className="text-slate-800">
                        {totals.pmWorkedHours.toFixed(2)}
                      </strong>
                    </span>
                    <span>
                      AM tips:{" "}
                      <strong className="text-slate-800">
                        ${totals.amTips.toFixed(2)}
                      </strong>
                    </span>
                    <span>
                      PM tips:{" "}
                      <strong className="text-slate-800">
                        ${totals.pmTips.toFixed(2)}
                      </strong>
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      Hours:{" "}
                      <strong className="text-slate-800">
                        {totals.amWorkedHours.toFixed(2)}
                      </strong>
                    </span>
                    <span>
                      Tips:{" "}
                      <strong className="text-slate-800">
                        ${totals.amTips.toFixed(2)}
                      </strong>
                    </span>
                  </>
                )}
                <span>
                  Total tips:{" "}
                  <strong className="text-slate-800">
                    ${totals.totalTips.toFixed(2)}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {totalRows > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50 hover:bg-slate-50"
              >
                Previous
              </button>
              <span className="text-sm text-slate-500">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 disabled:opacity-50 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
            </>
          )}
        </div>
      )}

      {manualRemoveRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-remove-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3
                  id="manual-remove-title"
                  className="text-base font-semibold text-slate-800"
                >
                  Remove manual entry?
                </h3>
                <p className="mt-2 text-sm text-slate-600">
                  This removes manual hours for{" "}
                  <strong className="text-slate-800">
                    {typeof manualRemoveRow.employeeId === "object" &&
                    manualRemoveRow.employeeId?.name
                      ? manualRemoveRow.employeeId.name
                      : "this employee"}
                  </strong>{" "}
                  on{" "}
                  <strong className="text-slate-800">
                    {breakdownView?.dateStr ?? "—"}
                  </strong>{" "}
                  at{" "}
                  <strong className="text-slate-800">
                    {breakdownLocation?.name ?? "this location"}
                  </strong>
                  . Recalculate after removal if you already loaded tips.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !manualRemoveSaving && setManualRemoveRow(null)}
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="mt-5 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setManualRemoveRow(null)}
                disabled={manualRemoveSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={confirmRemoveManual}
                disabled={manualRemoveSaving}
              >
                {manualRemoveSaving ? (
                  <>
                    {spinner}
                    Removing…
                  </>
                ) : (
                  "Remove"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {adjustModalOpen && adjustEmployee && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-800">
                  Adjustments — {adjustEmployee.employeeName}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Cash Advance is deducted only from this employee. Deduct &amp; Redistribute is deducted
                  from this employee then split equally across the other employees.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustModalOpen(false)}
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Cash Advance deduction ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustCashAdvance}
                  onChange={(e) => setAdjustCashAdvance(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Deduct &amp; Redistribute equally ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={adjustRedistribute}
                  onChange={(e) => setAdjustRedistribute(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAdjustModalOpen(false)}
                disabled={adjustSaving}
              >
                Cancel
              </Button>
              <Button type="button" onClick={saveAdjustments} disabled={adjustSaving}>
                {adjustSaving ? <>{spinner}Saving &amp; recalculating…</> : "Save adjustments"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
