import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";
import {
  getDailyTipInput,
  getDailyTipCalculation,
  upsertDailyTipInput,
  upsertDailyTipAdjustment,
} from "../services/dailyTipService";
import {
  getManualWorkingByDate,
  upsertManualWorking,
  deleteManualWorking,
} from "../services/manualWorkingService";
import { toDateString } from "../utils/dateUtils";
import { exportTableToCSV, exportTableToPDF } from "../utils/reportUtils";
import Button from "../components/ui/Button";

const PAGE_SIZES = [10, 25, 50, 100];

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
    setSelectedLocationId,
    locations,
    dailyTipsCache,
    setDailyTipsCache,
  } = useApp();
  const [date, setDate] = useState(
    () => dailyTipsCache?.date || toDateString(new Date()),
  );
  const [_input, setInput] = useState(null);
  const [calculation, setCalculation] = useState(
    () => dailyTipsCache?.calculation ?? null,
  );
  const [calculationError, setCalculationError] = useState(
    () => dailyTipsCache?.calculationError ?? null,
  );
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(
    () => dailyTipsCache?.form || { amGrossTips: "", pmGrossTips: "" },
  );
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
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
    amHours: "",
    pmHours: "",
  });
  const [manualRemoveRow, setManualRemoveRow] = useState(null);
  const [manualRemoveSaving, setManualRemoveSaving] = useState(false);

  const location = locations.find((l) => l._id === selectedLocationId);
  const isTheCove = (location?.name || '').trim().toLowerCase() === 'the cove';

  const load = useCallback(
    async (silent = false) => {
      if (!selectedLocationId) return;
      if (!silent) setLoading(true);
      setCalculationError(null);
      try {
        const [tipInput, calc] = await Promise.all([
          getDailyTipInput(selectedLocationId, date).catch(() => null),
          getDailyTipCalculation(selectedLocationId, date).catch(() => ({
            error: "Failed to load calculation",
          })),
        ]);
        setInput(tipInput || null);
        if (calc?.error) {
          setCalculation(null);
          setCalculationError(calc.error);
        } else {
          setCalculation(calc || null);
          setCalculationError(null);
        }
        if (tipInput)
          setForm({
            amGrossTips: String(tipInput.amGrossTips),
            pmGrossTips: isTheCove ? "" : String(tipInput.pmGrossTips),
          });
        else setForm({ amGrossTips: "", pmGrossTips: "" });
        setDailyTipsCache((prev) => ({
          ...prev,
          locationId: selectedLocationId,
          date,
          form: tipInput
            ? {
                amGrossTips: String(tipInput.amGrossTips),
                pmGrossTips: isTheCove ? "" : String(tipInput.pmGrossTips),
              }
            : { amGrossTips: "", pmGrossTips: "" },
          calculation: calc?.error ? null : calc || null,
          calculationError: calc?.error || null,
        }));
      } catch (_e) {
        setCalculationError("Failed to load data");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedLocationId, date, setDailyTipsCache, isTheCove],
  );

  useEffect(() => {
    if (!selectedLocationId) return;
    const cacheMatches =
      dailyTipsCache?.locationId === selectedLocationId &&
      dailyTipsCache?.date === date &&
      (dailyTipsCache?.calculation != null ||
        dailyTipsCache?.calculationError != null);
    load(cacheMatches);
  }, [load, selectedLocationId, date]);

  useEffect(() => {
    if (!selectedLocationId) return;
    setManualLoading(true);
    getManualWorkingByDate(selectedLocationId, date)
      .then(setManualRows)
      .catch(() => setManualRows([]))
      .finally(() => setManualLoading(false));
  }, [selectedLocationId, date]);

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
      await load(false);
    } catch (err) {
      toast.error(
        err.response?.data?.error || err.message || "Failed to delete",
      );
    } finally {
      setManualRemoveSaving(false);
    }
  }, [manualRemoveRow, load]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const am = parseFloat(form.amGrossTips);
    const pm = isTheCove ? 0 : parseFloat(form.pmGrossTips);
    if (isNaN(am) || am < 0) {
      setFormErrors({ amGrossTips: "Enter a valid amount ≥ 0" });
      toast.error("AM gross tips must be ≥ 0");
      return;
    }
    if (!isTheCove && (form.pmGrossTips === "" || isNaN(pm) || pm < 0)) {
      setFormErrors({ pmGrossTips: "Enter a valid amount ≥ 0" });
      toast.error("PM gross tips must be ≥ 0");
      return;
    }
    setFormErrors({});
    setSaving(true);
    try {
      await upsertDailyTipInput(selectedLocationId, date, {
        amGrossTips: am,
        pmGrossTips: pm,
      });
      toast.success("Tips saved");
      setDailyTipsCache((prev) => ({
        ...prev,
        locationId: selectedLocationId,
        date,
        form: { amGrossTips: String(am), pmGrossTips: String(pm) },
      }));
      await load();
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
    if (!selectedLocationId || !adjustEmployee?.employeeId) return;
    const cashAdvance = Math.max(0, parseFloat(adjustCashAdvance || "0") || 0);
    const redistribute = Math.max(0, parseFloat(adjustRedistribute || "0") || 0);
    setAdjustSaving(true);
    try {
      await Promise.all([
        upsertDailyTipAdjustment(selectedLocationId, date, {
          employeeId: adjustEmployee.employeeId,
          type: "cash_advance",
          amount: cashAdvance,
          reason: "",
        }),
        upsertDailyTipAdjustment(selectedLocationId, date, {
          employeeId: adjustEmployee.employeeId,
          type: "redistribute_equal",
          amount: redistribute,
          reason: "",
        }),
      ]);
      // Keep modal open while recalculation loads so the user sees progress.
      toast.success("Adjustments saved. Recalculating…");
      await load(false);
      setAdjustModalOpen(false);
    } catch (_e) {
      toast.error("Failed to save adjustments");
    } finally {
      setAdjustSaving(false);
    }
  }, [
    selectedLocationId,
    date,
    adjustEmployee,
    adjustCashAdvance,
    adjustRedistribute,
    load,
  ]);

  const showShiftSplit = !isTheCove;

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

  if (!selectedLocationId) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-800">Daily Tips</h1>
        <div className="rounded-xl border border-slate-200 bg-transparent p-5 shadow-sm">
          <p className="text-slate-600">Loading locations…</p>
        </div>
      </div>
    );
  }

  const amGross =
    calculation?.inputs?.amGrossTips ??
    (form.amGrossTips !== "" ? parseFloat(form.amGrossTips) : null);
  const pmGross =
    isTheCove
      ? 0
      : calculation?.inputs?.pmGrossTips ??
        (form.pmGrossTips !== "" ? parseFloat(form.pmGrossTips) : null);
  const totalGross =
    (typeof amGross === "number" && !Number.isNaN(amGross) ? amGross : 0) +
    (typeof pmGross === "number" && !Number.isNaN(pmGross) ? pmGross : 0);
  const productionDeductionDollars =
    calculation?.inputs != null
      ? (Number(calculation.inputs.productionDeductionAM) || 0) +
        (Number(calculation.inputs.productionDeductionPM) || 0)
      : totalGross > 0
        ? Math.round(totalGross * 0.04 * 100) / 100
        : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">Daily Tips</h1>
      <p className="text-slate-600">
        {location?.name} —
        {shiftDescriptionForLocation(location?.name)}
        4% is deducted for production pool
        {productionDeductionDollars != null && (
          <strong className="text-slate-800">
            {" "}
            (${productionDeductionDollars.toFixed(2)} today)
          </strong>
        )}
        . Save tips, then <strong>Load calculation</strong> — clock data is
        fetched from Connecteam for this date (no need to open Time Entries).
      </p>

      {/* Tip input row */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3">
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-end gap-4"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Location
            </label>
            <select
              value={selectedLocationId || ""}
              onChange={(e) => setSelectedLocationId(e.target.value || null)}
              className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
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
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {isTheCove ? 'Gross Tips ($)' : 'AM Gross Tips ($)'}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.amGrossTips}
              onChange={(e) =>
                setForm({ ...form, amGrossTips: e.target.value })
              }
              className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              placeholder="0"
            />
            {formErrors.amGrossTips && (
              <p className="mt-0.5 text-xs text-red-600">
                {formErrors.amGrossTips}
              </p>
            )}
          </div>
          {!isTheCove && (
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
                className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                placeholder="0"
              />
              {formErrors.pmGrossTips && (
                <p className="mt-0.5 text-xs text-red-600">
                  {formErrors.pmGrossTips}
                </p>
              )}
            </div>
          )}
          <Button type="submit" disabled={saving}>
            {saving ? <>{spinner}Saving…</> : "Save"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => load()}
            disabled={loading}
          >
            {loading ? <>{spinner}Loading…</> : "Load calculation"}
          </Button>
        </form>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Manual employees (not from Connecteam)
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Add worked hours for this location and date. They count toward tip
          split and weekly payout after you save and{" "}
          <strong className="text-slate-600">Load calculation</strong>.
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
            const am = parseFloat(manualForm.amHours) || 0;
            const pm = parseFloat(manualForm.pmHours) || 0;
            if (isTheCove) {
              if (am < 0) {
                toast.error("Hours must be ≥ 0");
                return;
              }
            } else if (am < 0 || pm < 0) {
              toast.error("Hours must be ≥ 0");
              return;
            }
            setManualSaving(true);
            try {
              await upsertManualWorking({
                employeeName: name,
                locationId: selectedLocationId,
                date,
                amHours: isTheCove ? am : am,
                pmHours: isTheCove ? 0 : pm,
                amTips: 0,
                pmTips: 0,
              });
              toast.success("Manual hours saved");
              setManualForm({ name: "", amHours: "", pmHours: "" });
              const list = await getManualWorkingByDate(
                selectedLocationId,
                date,
              );
              setManualRows(list);
              await load(false);
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
          {isTheCove ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Hours worked
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={manualForm.amHours}
                onChange={(e) =>
                  setManualForm((f) => ({ ...f, amHours: e.target.value }))
                }
                className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                placeholder="0"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  AM hours
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualForm.amHours}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, amHours: e.target.value }))
                  }
                  className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  placeholder="0"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  PM hours
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualForm.pmHours}
                  onChange={(e) =>
                    setManualForm((f) => ({ ...f, pmHours: e.target.value }))
                  }
                  className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                  placeholder="0"
                />
              </div>
            </>
          )}
          <Button type="submit" disabled={manualSaving}>
            {manualSaving ? "Saving…" : "Add / update"}
          </Button>
        </form>
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
                  {isTheCove ? (
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
                  return (
                    <tr key={row._id}>
                      <td className="py-2 font-medium text-slate-800">
                        {empName}
                      </td>
                      {isTheCove ? (
                        <td className="py-2 text-right tabular-nums text-slate-600">
                          {(Number(row.amHours) || 0) +
                            (Number(row.pmHours) || 0)}
                        </td>
                      ) : (
                        <>
                          <td className="py-2 text-right tabular-nums text-slate-600">
                            {Number(row.amHours) || 0}
                          </td>
                          <td className="py-2 text-right tabular-nums text-slate-600">
                            {Number(row.pmHours) || 0}
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
              {isTheCove ? (
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
                      exportTableToCSV(headers, rows, `daily-tips-${date}.csv`);
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
                        `Daily Tips — ${location?.name ?? ""} — ${date}`,
                        headers,
                        rows,
                        `daily-tips-${date}.pdf`,
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
                      {a.clockIn ?? "–"}
                    </td>
                    <td className="py-2 tabular-nums text-slate-600">
                      {a.clockOut ?? "–"}
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
                  on <strong className="text-slate-800">{date}</strong> at{" "}
                  <strong className="text-slate-800">
                    {location?.name ?? "this location"}
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
