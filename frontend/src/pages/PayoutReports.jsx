import { useState, useCallback, useMemo, useEffect } from "react";
import toast from "react-hot-toast";
import { useApp } from "../context/AppContext";
import {
  postWeeklyPayoutReport,
  getWeeklyPayoutReportEmployees,
} from "../services/weeklyPayoutService";
import {
  getWeekStart,
  getWeekEnd,
  toLocalDateString,
  getDateRangeColumns,
} from "../utils/dateUtils";
import {
  exportTableToCSV,
  exportTableToPDF,
  exportSingleEmployeeWeeklyPayoutPDF,
  groupPayoutsByLocationDisplayOrder,
  exportSectionedTableToCSV,
  exportSectionedTableToPDF,
  buildWeeklyPayoutExportMeta,
  formatCsvNumeric,
} from "../utils/reportUtils";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import {
  FiDownload,
  FiFileText,
  FiLayers,
  FiMapPin,
  FiUser,
} from "react-icons/fi";

const PDF_HEAD_INDIGO = [79, 70, 229];

function formatMoney(n) {
  return "$" + (Number(n) ?? 0).toFixed(2);
}

/** Safe fragment for export filenames when scope is a single location. */
function sanitizeExportSlug(name) {
  const s = String(name ?? "").trim();
  if (!s) return "location";
  const slug = s
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return slug || "location";
}

function getDefaultDateRange() {
  const mon = getWeekStart(new Date());
  const sun = getWeekEnd(mon);
  return { start: toLocalDateString(mon), end: toLocalDateString(sun) };
}

function payoutToExportRow(p, locLabel, cols, forCsv = false) {
  const fmtMoney = forCsv
    ? (n) => formatCsvNumeric(n, { maxFractionDigits: 2 })
    : formatMoney;
  const wh = p.totalWorkingMinutes ?? 0;
  const whStr =
    wh <= 0
      ? "-"
      : `${Math.floor(wh / 60)}h${wh % 60 ? ` ${wh % 60}m` : ""}`;
  return [
    p.employeeName ?? "",
    locLabel,
    ...cols.map((_, idx) =>
      fmtMoney((p.dailyTipsByDay || [])[idx] ?? 0),
    ),
    fmtMoney(p.weeklyGrossTips ?? p.dailyTipsMonToSun),
    whStr,
    String(p.weeklyTardinessMinutes ?? 0),
    `${p.tardinessPercent ?? 0}%`,
    fmtMoney(p.tardinessDeduction),
    fmtMoney(p.weeklyAfterTardiness),
    fmtMoney(p.manualDeduction),
    fmtMoney(p.netWeeklyTips),
    fmtMoney(p.tardinessRedistribution ?? 0),
    fmtMoney(p.finalWeeklyTipsPayable ?? 0),
  ];
}

const weeklyReportHeaders = (dateCols) => [
  "Employee",
  "Location",
  ...dateCols.map((c) => c.label),
  "Weekly Gross Tips",
  "Working hours",
  "Weekly Tardiness (min)",
  "Tardiness %",
  "Tardiness Deduction",
  "Weekly After Tardiness",
  "Manual Deduction",
  "Net Weekly Tips",
  "Tardiness Redistribution",
  "Final Weekly Tips Payable",
];

export default function PayoutReports() {
  const { selectedLocationId, locations } = useApp();
  const activeLocations = useMemo(
    () => locations.filter((loc) => loc.isActive !== false),
    [locations],
  );
  const defaultRange = useMemo(() => getDefaultDateRange(), []);
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [geographicScope, setGeographicScope] = useState("one_location");
  const [singleLocationId, setSingleLocationId] = useState("");
  const [employeeScope, setEmployeeScope] = useState("all");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [exporting, setExporting] = useState(false);

  const selectedEmployeeLabel = useMemo(() => {
    const opt = employeeOptions.find((e) => e.employeeId === selectedEmployeeId);
    if (!opt) return "";
    return geographicScope === "all_locations"
      ? `${opt.employeeName} — ${opt.locationName}`
      : opt.employeeName;
  }, [employeeOptions, selectedEmployeeId, geographicScope]);

  useEffect(() => {
    if (geographicScope !== "one_location" || singleLocationId) return;
    const headerIsActive = activeLocations.some(
      (l) => l._id === selectedLocationId,
    );
    if (selectedLocationId && headerIsActive) {
      setSingleLocationId(selectedLocationId);
    }
  }, [
    geographicScope,
    singleLocationId,
    selectedLocationId,
    activeLocations,
  ]);

  useEffect(() => {
    if (employeeScope !== "one_employee") {
      setEmployeeOptions([]);
      setSelectedEmployeeId("");
      return;
    }
    const sd = startDate.trim().slice(0, 10);
    const ed = endDate.trim().slice(0, 10);
    if (
      !sd ||
      !ed ||
      new Date(`${ed}T12:00:00`) < new Date(`${sd}T12:00:00`)
    ) {
      setEmployeeOptions([]);
      return;
    }
    if (geographicScope === "one_location" && !singleLocationId) {
      setEmployeeOptions([]);
      return;
    }

    let cancelled = false;
    setLoadingEmployees(true);
    getWeeklyPayoutReportEmployees({
      startDate: sd,
      endDate: ed,
      geographicScope,
      ...(geographicScope === "one_location"
        ? { singleLocationId }
        : {}),
    })
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.employees) ? res.employees : [];
        setEmployeeOptions(list);
      })
      .catch(() => {
        if (!cancelled) setEmployeeOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEmployees(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    startDate,
    endDate,
    geographicScope,
    singleLocationId,
    employeeScope,
  ]);

  useEffect(() => {
    if (!selectedEmployeeId || employeeOptions.length === 0) return;
    const ok = employeeOptions.some((e) => e.employeeId === selectedEmployeeId);
    if (!ok) setSelectedEmployeeId("");
  }, [employeeOptions, selectedEmployeeId]);

  const scopeSummary = useCallback(() => {
    if (geographicScope === "all_locations") return "All locations";
    const loc = activeLocations.find((l) => l._id === singleLocationId);
    return loc?.name || "One location";
  }, [geographicScope, singleLocationId, activeLocations]);

  const buildRequestBody = useCallback(() => {
    const sd = startDate.trim().slice(0, 10);
    const ed = endDate.trim().slice(0, 10);
    if (
      !sd ||
      !ed ||
      new Date(`${ed}T12:00:00`) < new Date(`${sd}T12:00:00`)
    ) {
      toast.error("Please select a valid date range (From ≤ To).");
      return null;
    }
    if (geographicScope === "one_location" && !singleLocationId) {
      toast.error("Choose which location to include.");
      return null;
    }
    if (employeeScope === "one_employee" && !String(selectedEmployeeId || "").trim()) {
      toast.error("Select an employee.");
      return null;
    }
    const body = {
      startDate: sd,
      endDate: ed,
      geographicScope,
      employeeScope,
    };
    if (geographicScope === "one_location") {
      body.singleLocationId = singleLocationId;
    }
    if (employeeScope === "one_employee") {
      body.employeeId = String(selectedEmployeeId).trim();
    }
    return body;
  }, [
    startDate,
    endDate,
    geographicScope,
    singleLocationId,
    employeeScope,
    selectedEmployeeId,
  ]);

  const runExport = useCallback(
    async (kind) => {
      const body = buildRequestBody();
      if (!body) return;

      setExporting(true);
      try {
        const reportData = await postWeeklyPayoutReport(body);
        if (reportData?.exportSkippedReason === "location_inactive") {
          toast(
            "This location is not active. Choose an active site or use All locations (active only).",
          );
          return;
        }
        const payouts = reportData?.payouts ?? [];
        if (!payouts.length) {
          if (employeeScope === "one_employee") {
            toast.error(
              "No payout row for that employee in the saved data for this range.",
            );
          } else {
            toast.error("Saved payout has no rows to export for this scope.");
          }
          return;
        }

        const sd =
          reportData.dateRange?.startDate ?? startDate.trim().slice(0, 10);
        const ed =
          reportData.dateRange?.endDate ?? endDate.trim().slice(0, 10);
        const cols = getDateRangeColumns(sd, ed);
        const hdr = weeklyReportHeaders(cols);
        const exportMeta = buildWeeklyPayoutExportMeta(sd, ed, scopeSummary());

        const oneLocationLabel =
          geographicScope === "one_location"
            ? (() => {
                const fromList = activeLocations.find(
                  (l) => String(l._id) === String(singleLocationId),
                )?.name;
                if (fromList) return fromList;
                const fromPayout = String(
                  payouts[0]?.locationName ?? "",
                ).trim();
                return fromPayout || "location";
              })()
            : "";
        const scopeSlug =
          geographicScope === "all_locations"
            ? "all-locations"
            : sanitizeExportSlug(oneLocationLabel);
        const empSlug =
          employeeScope === "one_employee"
            ? `emp-${String(selectedEmployeeId).slice(0, 12)}`
            : "all-employees";
        const fileBase = `weekly-payout-report-${scopeSlug}-${empSlug}-${sd}-${ed}`;

        const forCsv = kind === "csv";
        const allLocationsAllEmployees =
          geographicScope === "all_locations" && employeeScope !== "one_employee";

        if (allLocationsAllEmployees) {
          const groups = groupPayoutsByLocationDisplayOrder(
            payouts,
            activeLocations,
          );
          const sections = groups.map((g) => ({
            sectionTitle: g.label,
            headers: hdr,
            rows: g.payouts.map((p) =>
              payoutToExportRow(p, p.locationName ?? g.label, cols, forCsv),
            ),
          }));
          if (kind === "csv") {
            exportSectionedTableToCSV(
              exportMeta.csvMetaLines,
              sections,
              `${fileBase}.csv`,
            );
          } else {
            exportSectionedTableToPDF(
              "",
              sections,
              `${fileBase}.pdf`,
              {
                headFillColor: PDF_HEAD_INDIGO,
                weeklyPayoutHeader: exportMeta.weeklyPayoutHeader,
              },
            );
          }
        } else {
          const orderedPayouts =
            geographicScope === "all_locations"
              ? groupPayoutsByLocationDisplayOrder(
                  payouts,
                  activeLocations,
                ).flatMap((g) => g.payouts)
              : payouts;
          const rows = orderedPayouts.map((p) =>
            payoutToExportRow(p, p.locationName ?? "-", cols, forCsv),
          );

          if (kind === "csv") {
            exportTableToCSV(hdr, rows, `${fileBase}.csv`);
          } else if (employeeScope === "one_employee") {
            exportSingleEmployeeWeeklyPayoutPDF({
              headers: hdr,
              rows,
              filename: `${fileBase}.pdf`,
              searchQuery: selectedEmployeeLabel || String(selectedEmployeeId),
              periodLabel: `${sd} - ${ed}`,
              scopeLabel: scopeSummary(),
              payouts: orderedPayouts,
            });
          } else {
            exportTableToPDF("", hdr, rows, `${fileBase}.pdf`, {
              headFillColor: PDF_HEAD_INDIGO,
              weeklyPayoutHeader: exportMeta.weeklyPayoutHeader,
            });
          }
        }
        toast.success(kind === "csv" ? "CSV downloaded." : "PDF downloaded.");
      } catch (err) {
        if (err.response?.status === 404) {
          toast.error(
            err.response?.data?.error ||
              "Data is not present in the database for this location and date range. Load payout on the Weekly Payout page first.",
          );
        } else {
          const msg =
            err.response?.data?.error ||
            err.message ||
            "Could not load saved payout for export.";
          toast.error(msg);
        }
      } finally {
        setExporting(false);
      }
    },
    [
      buildRequestBody,
      startDate,
      endDate,
      geographicScope,
      singleLocationId,
      employeeScope,
      selectedEmployeeId,
      selectedEmployeeLabel,
      scopeSummary,
      activeLocations,
    ],
  );

  const scopeCardClass = (active) =>
    `relative flex cursor-pointer flex-col rounded-xl border p-4 text-left transition-all ${
      active
        ? "border-indigo-400 bg-indigo-50/80 shadow-sm ring-2 ring-indigo-200"
        : "border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50"
    }`;

  return (
    <div className="scheme-light space-y-6 pb-8 text-slate-800">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Weekly payout reports
        </h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
          Exports use payout data saved in the database from the Weekly Payout
          page (same From / To dates and Load payout or Recalculate). Pick scope
          and dates here, then download CSV or PDF.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-gray-300 bg-gray-200 p-0 shadow-sm lg:col-span-1">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
            Date range
          </h2>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                From
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">
                To
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
        </Card>

        <Card className="border-gray-300 bg-gray-200 p-0 shadow-sm lg:col-span-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
            <FiLayers className="h-4 w-4 shrink-0 text-indigo-600" />
            Scope — location
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            One location: active sites only (dropdown below; defaults to the header
            when it is active). All locations includes every active site that has
            saved payout for the range; sites without data are skipped.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              className={scopeCardClass(geographicScope === "one_location")}
              onClick={() => {
                setGeographicScope("one_location");
                setSingleLocationId((prev) => {
                  if (prev) return prev;
                  const headerActive = activeLocations.some(
                    (l) => l._id === selectedLocationId,
                  );
                  return headerActive ? selectedLocationId : "";
                });
              }}
            >
              <span className="text-sm font-semibold text-slate-800">
                One location
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Choose a specific location below
              </span>
            </button>
            <button
              type="button"
              className={scopeCardClass(geographicScope === "all_locations")}
              onClick={() => setGeographicScope("all_locations")}
            >
              <span className="text-sm font-semibold text-slate-800">
                All locations
              </span>
              <span className="mt-1 text-xs text-slate-500">
                Every location in one export
              </span>
            </button>
          </div>
          {geographicScope === "one_location" && (
            <div className="mt-4">
              <label className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-600">
                <FiMapPin className="h-3.5 w-3.5 text-indigo-500" />
                Location
              </label>
              <select
                value={singleLocationId}
                onChange={(e) => setSingleLocationId(e.target.value)}
                className="w-full max-w-md rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                <option value="">Select location…</option>
                {activeLocations.map((loc) => (
                  <option key={loc._id} value={loc._id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Card>
      </div>

      <Card className="border-gray-300 bg-gray-200 p-0 shadow-sm">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
          <FiUser className="h-4 w-4 shrink-0 text-indigo-600" />
          Scope — employees
        </h2>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="employeeScope"
                checked={employeeScope === "all"}
                onChange={() => {
                  setEmployeeScope("all");
                  setSelectedEmployeeId("");
                }}
                className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              All employees
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="employeeScope"
                checked={employeeScope === "one_employee"}
                onChange={() => {
                  setEmployeeScope("one_employee");
                  setSelectedEmployeeId("");
                }}
                className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              One employee
            </label>
          </div>
          {employeeScope === "one_employee" && (
            <div className="min-w-[220px] flex-1 sm:max-w-md">
              <label className="mb-1 block text-xs font-medium text-slate-500">
                Employee (from saved payout for this date range)
              </label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                disabled={loadingEmployees}
                className="w-full rounded-lg border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
              >
                <option value="">
                  {loadingEmployees
                    ? "Loading employees…"
                    : employeeOptions.length === 0
                      ? "No saved payout — load payout on Weekly Payout first"
                      : "Select employee…"}
                </option>
                {employeeOptions.map((e) => (
                  <option
                    key={`${e.locationId}-${e.employeeId}`}
                    value={e.employeeId}
                  >
                    {geographicScope === "all_locations"
                      ? `${e.employeeName} — ${e.locationName}`
                      : e.employeeName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      <div className="rounded-xl border border-gray-300 bg-gray-200 p-5 text-slate-800 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Report
            </p>
            <p className="mt-1 text-sm font-medium text-slate-800">
              {scopeSummary()}
              {employeeScope === "one_employee" && selectedEmployeeLabel
                ? ` · Employee: ${selectedEmployeeLabel}`
                : employeeScope === "one_employee"
                  ? " · Employee: (select)"
                  : ""}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              {startDate.trim().slice(0, 10)} – {endDate.trim().slice(0, 10)}
              · Downloads read saved payout from the database (no live
              recalculation).
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="primary"
              disabled={exporting}
              onClick={() => runExport("csv")}
              className="inline-flex items-center gap-2"
            >
              <FiFileText className="h-4 w-4" />
              {exporting ? "…" : "Export CSV"}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={exporting}
              onClick={() => runExport("pdf")}
              className="inline-flex items-center gap-2"
            >
              <FiDownload className="h-4 w-4" />
              {exporting ? "…" : "Export PDF"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
