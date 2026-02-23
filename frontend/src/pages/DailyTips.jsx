import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";
import {
  getDailyTipInput,
  getDailyTipCalculation,
  upsertDailyTipInput,
} from "../services/dailyTipService";
import { toDateString } from "../utils/dateUtils";
import { exportTableToCSV, exportTableToPDF } from "../utils/reportUtils";
import Button from "../components/ui/Button";

const PAGE_SIZES = [10, 25, 50, 100];

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
  const [input, setInput] = useState(null);
  const [calculation, setCalculation] = useState(
    () => dailyTipsCache?.calculation ?? null,
  );
  const [calculationError, setCalculationError] = useState(
    () => dailyTipsCache?.calculationError ?? null,
  );
  const hasCachedResult = !!(
    dailyTipsCache?.locationId &&
    dailyTipsCache?.date &&
    (dailyTipsCache?.calculation || dailyTipsCache?.calculationError)
  );
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(
    () => dailyTipsCache?.form || { amGrossTips: "", pmGrossTips: "" },
  );
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const location = locations.find((l) => l._id === selectedLocationId);

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
            pmGrossTips: String(tipInput.pmGrossTips),
          });
        else setForm({ amGrossTips: "", pmGrossTips: "" });
        setDailyTipsCache((prev) => ({
          ...prev,
          locationId: selectedLocationId,
          date,
          form: tipInput
            ? {
                amGrossTips: String(tipInput.amGrossTips),
                pmGrossTips: String(tipInput.pmGrossTips),
              }
            : { amGrossTips: "", pmGrossTips: "" },
          calculation: calc?.error ? null : calc || null,
          calculationError: calc?.error || null,
        }));
      } catch (e) {
        setCalculationError("Failed to load data");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [selectedLocationId, date, setDailyTipsCache],
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    const am = parseFloat(form.amGrossTips);
    const pm = parseFloat(form.pmGrossTips);
    if (isNaN(am) || am < 0) {
      setFormErrors({ amGrossTips: "Enter a valid amount ≥ 0" });
      toast.error("AM gross tips must be ≥ 0");
      return;
    }
    if (isNaN(pm) || pm < 0) {
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
            totalTips: acc.totalTips + (Number(a.totalTips) || 0),
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
    calculation?.inputs?.pmGrossTips ??
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
        {location?.name} — Enter gross tips per shift (AM 06:00–15:00, PM
        15:00–23:00). 4% is deducted for production pool
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
              AM Gross Tips ($)
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

          <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-3">
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
              <span>
                4% production pool:{" "}
                <strong className="text-slate-800">
                  ${productionDeductionDollars?.toFixed(2) ?? "0.00"}
                </strong>
              </span>
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
                        a.totalTips != null
                          ? `$${Number(a.totalTips).toFixed(2)}`
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
                        a.totalTips != null
                          ? `$${Number(a.totalTips).toFixed(2)}`
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
                  <th className="pb-2 text-right font-medium text-slate-700">
                    Total
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
                    <td className="py-2 text-right font-medium tabular-nums text-slate-800">
                      ${a.totalTips?.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot className="border-t-2 border-slate-300">
                  <tr className="bg-slate-100 font-semibold">
                    <td className="py-3 pl-2 text-slate-800">Total</td>
                    <td className="py-3" colSpan={2} />
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
                    <td className="py-3 text-right tabular-nums text-slate-800">
                      ${totals.totalTips.toFixed(2)}
                    </td>
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
    </div>
  );
}
