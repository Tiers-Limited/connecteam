import { useEffect, useState, useCallback } from "react";
import toast from "react-hot-toast";
import {
  getWeeklyProductionPayout,
  getProductionManualDeductions,
  getLocationWiseProductionPool,
  upsertProductionManualDeduction,
  updateProductionStaff,
} from "../services/productionService";
import {
  getWeekStart,
  getWeekEnd,
  toLocalDateString,
  formatWeekRange,
  getWeekDateColumns,
  getDateRangeColumns,
} from "../utils/dateUtils";
import {
  formatCsvNumeric,
} from "../utils/reportUtils";
import { FiInbox } from "react-icons/fi";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";

function formatMoney(n) {
  return "$" + (Number(n) ?? 0).toFixed(2);
}

function formatMoneyCsv(n) {
  return formatCsvNumeric(n, { maxFractionDigits: 2 });
}

function getDefaultDateRange() {
  const mon = getWeekStart(new Date());
  const sun = getWeekEnd(mon);
  return { start: toLocalDateString(mon), end: toLocalDateString(sun) };
}

function LightCard({ children, className = "", title }) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white/90 backdrop-blur-sm shadow-xl px-6 py-5 dark:border-white/10 dark:bg-white/5 ${className}`}
    >
      {title && (
        <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      )}
      {children}
    </div>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="py-6">
      <div className="mx-auto flex max-w-md flex-col items-center gap-2 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-300/30 dark:bg-indigo-500/10 dark:text-indigo-300">
          <FiInbox className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          {title}
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
      </div>
    </div>
  );
}

export default function ProductionPool() {
  const defaultRange = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modalRow, setModalRow] = useState(null);
  const [editAllocationPercent, setEditAllocationPercent] = useState("");
  const [editSubjectToTardiness, setEditSubjectToTardiness] = useState(true);
  const [editManualAmount, setEditManualAmount] = useState("");
  const [editManualReason, setEditManualReason] = useState("");
  const [manualEdits, setManualEdits] = useState({});
  const [saving, setSaving] = useState(false);
  const [locationWisePool, setLocationWisePool] = useState([]);

  const loadPayout = useCallback(() => {
    const start = startDate.trim().slice(0, 10);
    const end = endDate.trim().slice(0, 10);
    if (
      !start ||
      !end ||
      new Date(end + "T12:00:00") < new Date(start + "T12:00:00")
    ) {
      toast.error("Please select a valid date range (From <= To).");
      return;
    }
    setLoading(true);
    Promise.all([
      getWeeklyProductionPayout(start, start, end),
      getLocationWiseProductionPool(start, start, end),
    ])
      .then(([res, locationList]) => {
        setData(res);
        setLocationWisePool(Array.isArray(locationList) ? locationList : []);
        toast.success(
          `Loaded production payout for ${res?.payouts?.length ?? 0} staff.`,
        );
      })
      .catch(() => {
        setData(null);
        setLocationWisePool([]);
        toast.error("Failed to load production payout");
      })
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  const getStaffId = (p) => p?.productionStaffId?._id ?? p?.productionStaffId;

  const openModal = useCallback(
    (p) => {
      setModalRow(p);
      setEditAllocationPercent(String(p.allocationPercent ?? 0));
      setEditSubjectToTardiness(p.subjectToTardiness !== false);
      setEditManualAmount(String(p.manualDeduction ?? 0));
      setEditManualReason(manualEdits[getStaffId(p)]?.reason ?? "");
    },
    [manualEdits],
  );

  const closeModal = useCallback(() => setModalRow(null), []);

  const handleSave = useCallback(async () => {
    if (!modalRow) return;
    const staffId = getStaffId(modalRow);
    if (!staffId) {
      toast.error("Invalid staff");
      return;
    }
    const amt = parseFloat(editManualAmount) || 0;
    const reason = editManualReason.trim();
    if (amt > 0 && !reason) {
      toast.error("Reason is required when manual deduction > 0");
      return;
    }
    const alloc = parseFloat(editAllocationPercent);
    if (isNaN(alloc) || alloc < 0 || alloc > 100) {
      toast.error("Allocation % must be between 0 and 100");
      return;
    }
    setSaving(true);
    try {
      const savedStaff = await updateProductionStaff(staffId, {
        allocationPercent: Number(alloc),
        subjectToTardiness: Boolean(editSubjectToTardiness),
      });
      await upsertProductionManualDeduction({
        productionStaffId: staffId,
        weekStart: startDate.trim().slice(0, 10),
        amount: amt,
        reason: amt > 0 ? reason : "",
      });
      toast.success(`Saved for ${modalRow.name}`);
      closeModal();
      const staffIdStr = String(staffId);
      setData((prev) => {
        if (!prev?.payouts?.length) return prev;
        return {
          ...prev,
          payouts: prev.payouts.map((p) => {
            if (String(getStaffId(p) ?? "") !== staffIdStr) return p;
            return {
              ...p,
              allocationPercent:
                savedStaff?.allocationPercent ?? Number(alloc),
              subjectToTardiness:
                savedStaff?.subjectToTardiness ?? Boolean(editSubjectToTardiness),
              manualDeduction: amt,
              manualDeductionReason: amt > 0 ? reason : "",
            };
          }),
        };
      });
      setManualEdits((prev) => ({
        ...prev,
        [staffIdStr]: { amount: String(amt), reason: amt > 0 ? reason : "" },
      }));
      await loadPayout();
    } catch (e) {
      if (e.response?.data?.details) {
        e.response.data.details.forEach((d) => toast.error(d.message));
      } else {
        toast.error(e.response?.data?.error || "Failed to save");
      }
    } finally {
      setSaving(false);
    }
  }, [
    modalRow,
    startDate,
    editAllocationPercent,
    editSubjectToTardiness,
    editManualAmount,
    editManualReason,
    closeModal,
    loadPayout,
  ]);

  useEffect(() => {
    if (!data?.payouts?.length) return;
    const m = {};
    data.payouts.forEach((p) => {
      const id = getStaffId(p);
      if (id) m[id] = { amount: String(p.manualDeduction ?? 0), reason: "" };
    });
    setManualEdits(m);
    getProductionManualDeductions(startDate.trim().slice(0, 10))
      .then((list) => {
        const next = { ...m };
        list.forEach((r) => {
          const id = r.productionStaffId?._id || r.productionStaffId;
          if (id)
            next[id] = {
              amount: String(r.amount ?? 0),
              reason: r.reason || "",
            };
        });
        setManualEdits(next);
      })
      .catch(() => {});
  }, [startDate, data?.payouts]);

  useEffect(() => {
    if (!modalRow) return;
    const onEscape = (e) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [modalRow, closeModal]);

  const payouts = data?.payouts ?? [];
  const dateColumns = data?.dateRange
    ? getDateRangeColumns(data.dateRange.startDate, data.dateRange.endDate)
    : getWeekDateColumns(startDate);
  const totalPoolFromLocations = locationWisePool.reduce(
    (sum, row) => sum + (Number(row.weeklyPool) || 0),
    0,
  );

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-100 via-white to-slate-50 p-4 shadow-2xl sm:p-6 dark:border-white/10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="pointer-events-none absolute -top-24 -right-8 h-56 w-56 rounded-full bg-indigo-500/15 blur-3xl dark:bg-indigo-500/20" />
      <div className="pointer-events-none absolute -bottom-24 -left-8 h-64 w-64 rounded-full bg-fuchsia-500/10 blur-3xl" />
      <div className="relative space-y-6">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Production Pool</h1>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
              From date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:ring-amber-400/50 dark:[&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:opacity-75 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
              To date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:ring-amber-400/50 dark:[&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:opacity-75 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
          </div>
          <Button onClick={loadPayout} disabled={loading}>
            {loading ? "Loading..." : "Load payout"}
          </Button>
        </div>
      </div>

      {data && (
        <>
          {/* Weekly payout table */}
          <LightCard title="Weekly Production Payout Table">
            <div className="prodpool-scroll overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-white/10">
                    <th className="sticky left-0 z-[3] w-12 min-w-[3rem] max-w-[3rem] whitespace-nowrap bg-white pb-3 pr-2 text-center font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      Action
                    </th>
                    <th className="sticky left-12 z-[2] whitespace-nowrap bg-white pb-3 pr-4 text-left font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      Employee
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Allocation %
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Gross Production Tips (Weekly)
                    </th>
                    {dateColumns.map((col) => (
                      <th
                        key={`gross-${col.dateKey}`}
                        className="whitespace-nowrap pb-3 pr-3 text-right font-semibold text-slate-600 dark:text-slate-300"
                      >
                        Gross ({col.label})
                      </th>
                    ))}
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Weekly Tardiness (min)
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Tardiness %
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Tardiness Deduction
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Manual Deduction
                    </th>
                    <th className="whitespace-nowrap pb-3 pr-4 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Redistribution Received
                    </th>
                    <th className="whitespace-nowrap pb-3 pl-4 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Final Weekly Production Payout
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                  {payouts.map((p) => (
                    <tr
                      key={p.productionStaffId}
                      className="transition-colors hover:bg-slate-100/70 dark:hover:bg-white/5"
                    >
                      <td className="sticky left-0 z-[2] w-12 min-w-[3rem] max-w-[3rem] bg-white py-3 pr-2 text-center dark:bg-slate-900">
                        <button
                          type="button"
                          onClick={() => openModal(p)}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-amber-400 hover:text-amber-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:border-amber-300/60 dark:hover:text-amber-300"
                          title="Edit allocation & manual deduction"
                        >
                          Edit
                        </button>
                      </td>
                      <td className="sticky left-12 z-[1] bg-white py-3 pr-4 font-medium text-slate-900 dark:bg-slate-900 dark:text-slate-100">
                        {p.name}
                        {!p.subjectToTardiness && (
                          <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">
                            (exempt)
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {p.allocationPercent ?? 0}%
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums font-medium text-slate-900 dark:text-slate-100">
                        {formatMoney(p.weeklyGrossProductionTips)}
                      </td>
                      {dateColumns.map((col, i) => (
                        <td
                          key={`daily-gross-${getStaffId(p)}-${col.dateKey}`}
                          className="py-3 pr-3 text-right tabular-nums text-slate-700 dark:text-slate-200"
                        >
                          {formatMoney((p.dailyByDay || [])[i] || 0)}
                        </td>
                      ))}
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {p.weeklyTardinessMinutes ?? 0}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {p.tardinessPercent ?? 0}%
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-amber-700 dark:text-amber-300">
                        {formatMoney(p.tardinessDeduction)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-slate-700 dark:text-slate-200">
                        {formatMoney(p.manualDeduction)}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums text-emerald-700 dark:text-emerald-300">
                        {formatMoney(p.tardinessRedistribution ?? 0)}
                      </td>
                      <td className="py-3 pl-4 text-right tabular-nums font-semibold text-slate-950 dark:text-white">
                        {formatMoney(p.finalWeeklyProductionPayout ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {payouts.length === 0 && (
              <EmptyState
                title="No payout rows found"
                message="No staff payout records are available for the selected date range."
              />
            )}
          </LightCard>

          {/* Location-wise pool */}
          <LightCard title="Location-wise tip pool">
            <div className="prodpool-scroll overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm">
                <thead>
                  <tr className="border-b-2 border-slate-200 dark:border-white/10">
                    <th className="sticky left-0 z-[2] whitespace-nowrap border-r border-slate-200 bg-white/95 pb-3 pr-4 text-left font-semibold text-slate-600 dark:border-white/5 dark:bg-slate-900/70 dark:text-slate-300">
                      Location
                    </th>
                    {(data?.dateRange
                      ? getDateRangeColumns(
                          data.dateRange.startDate,
                          data.dateRange.endDate,
                        )
                      : getWeekDateColumns(startDate)
                    ).map((col) => (
                      <th
                        key={col.dateKey}
                        className="whitespace-nowrap pb-3 pr-3 text-right font-semibold text-slate-600 dark:text-slate-300"
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="whitespace-nowrap pb-3 pl-3 text-right font-semibold text-slate-600 dark:text-slate-300">
                      Weekly total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/10">
                  {locationWisePool.map((row) => (
                    <tr
                      key={row.locationId}
                      className="transition-colors hover:bg-slate-100/70 dark:hover:bg-white/5"
                    >
                      <td className="sticky left-0 z-[1] border-r border-slate-200 bg-white/95 py-3 pr-4 font-medium text-slate-900 dark:border-white/5 dark:bg-slate-900/60 dark:text-slate-100">
                        {row.locationName}
                      </td>
                      {(row.dailyByDay || []).map((val, i) => (
                        <td
                          key={i}
                          className="py-3 pr-3 text-right tabular-nums text-slate-700 dark:text-slate-200"
                        >
                          {formatMoney(val)}
                        </td>
                      ))}
                      <td className="py-3 pl-3 text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatMoney(row.weeklyPool ?? 0)}
                      </td>
                    </tr>
                  ))}
                  {locationWisePool.length > 0 && (
                    <tr className="border-t-2 border-slate-200 bg-slate-100/70 font-semibold dark:border-white/10 dark:bg-white/5">
                      <td className="sticky left-0 z-[1] border-r border-slate-200 bg-slate-100 py-3 pr-4 text-slate-900 dark:border-white/5 dark:bg-slate-800/70 dark:text-slate-100">Total</td>
                      {(data?.dateRange
                        ? getDateRangeColumns(
                            data.dateRange.startDate,
                            data.dateRange.endDate,
                          )
                        : getWeekDateColumns(startDate)
                      ).map((_, i) => (
                        <td
                          key={i}
                          className="py-3 pr-3 text-right tabular-nums text-slate-900 dark:text-slate-100"
                        >
                          {formatMoney(
                            locationWisePool.reduce(
                              (s, row) =>
                                s + (Number((row.dailyByDay || [])[i]) || 0),
                              0,
                            ),
                          )}
                        </td>
                      ))}
                      <td className="py-3 pl-3 text-right tabular-nums text-slate-950 dark:text-white">
                        {formatMoney(totalPoolFromLocations)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {locationWisePool.length === 0 && (
              <EmptyState
                title="No location pool data"
                message="No location-wise pool totals are available for the selected date range."
              />
            )}
          </LightCard>
        </>
      )}

      {!data && !loading && (
        <LightCard>
          <EmptyState
            title="No data loaded"
            message="Select a valid date range and click Load payout to fetch production pool data."
          />
        </LightCard>
      )}

      {/* Modal */}
      {modalRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="production-modal-title"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-slate-900/95"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="production-modal-title"
              className="text-lg font-semibold text-slate-900 dark:text-white"
            >
              Allocation & deductions -- {modalRow.name}
            </h2>
            <div className="mt-5 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Allocation %
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={editAllocationPercent}
                  onChange={(e) => setEditAllocationPercent(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:focus:ring-amber-400/50"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="subjectToTardiness"
                  checked={editSubjectToTardiness}
                  onChange={(e) => setEditSubjectToTardiness(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <label
                  htmlFor="subjectToTardiness"
                  className="text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Subject to tardiness (uncheck for senior/exempt)
                </label>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Weekly tardiness (min)
                </label>
                <p className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-white/15 dark:bg-white/5 dark:text-slate-200">
                  {modalRow.weeklyTardinessMinutes ?? 0} min (from Weekly
                  Tardiness)
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Manual deduction ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editManualAmount}
                  onChange={(e) => setEditManualAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:focus:ring-amber-400/50"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Reason{" "}
                  <span className="text-slate-500 dark:text-slate-400">
                    (required if amount &gt; 0)
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Uniform, equipment"
                  value={editManualReason}
                  onChange={(e) => setEditManualReason(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/15 dark:bg-white/5 dark:text-slate-100 dark:focus:ring-amber-400/50"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-white/15 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
              >
                Cancel
              </button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
