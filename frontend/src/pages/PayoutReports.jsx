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
  columnsFromDayDateKeys,
} from "../utils/dateUtils";
import { getWeeklyTardiness } from "../services/weeklyTardinessService";
import { getDailyTipCalculation } from "../services/dailyTipService";
import {
  getWeeklyProductionPayout,
  getLocationWiseProductionPool,
} from "../services/productionService";
import {
  exportTableToCSV,
  exportTableToPDF,
  exportSingleEmployeeWeeklyPayoutPDF,
  groupPayoutsByLocationDisplayOrder,
  exportSectionedTableToCSV,
  exportSectionedTableToPDF,
  buildWeeklyPayoutExportMeta,
  exportMultiTableToCSV,
  exportMultiTableToPDF,
  formatCsvNumeric,
} from "../utils/reportUtils";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";

const PDF_HEAD_INDIGO = [79, 70, 229];

function formatMoney(n) {
  return "$" + (Number(n) ?? 0).toFixed(2);
}

function getDefaultDateRange() {
  const mon = getWeekStart(new Date());
  const sun = getWeekEnd(mon);
  return { start: toLocalDateString(mon), end: toLocalDateString(sun) };
}

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

function formatDurationForReport(totalMinutes) {
  const mins = Math.max(0, Number(totalMinutes) || 0);
  if (mins <= 0) return "-";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m ? ` ${m}m` : ""} (${(mins / 60).toFixed(2)}h)`;
}

function breakMinutesFromPayout(p) {
  const direct = Number(p?.totalBreakMinutes);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  if (Array.isArray(p?.dailyBreakdown)) {
    return p.dailyBreakdown.reduce(
      (sum, d) => sum + (Number(d?.breakMinutes) || 0),
      0,
    );
  }
  return 0;
}

function payoutToExportRow(p, locLabel, cols, forCsv = false) {
  const fmtMoney = forCsv
    ? (n) => formatCsvNumeric(n, { maxFractionDigits: 2 })
    : formatMoney;
  return [
    p.employeeName ?? "",
    locLabel,
    ...cols.map((_, idx) => fmtMoney((p.dailyTipsByDay || [])[idx] ?? 0)),
    fmtMoney(p.weeklyGrossTips ?? p.dailyTipsMonToSun),
    formatDurationForReport(p.totalWorkingMinutes ?? 0),
    formatDurationForReport(breakMinutesFromPayout(p)),
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

function timeToMinutes(str) {
  if (!str || typeof str !== "string") return Infinity;
  const [h, m] = str.trim().split(":").map(Number);
  if (Number.isNaN(h)) return Infinity;
  return (h || 0) * 60 + (Number.isNaN(m) ? 0 : m);
}

function toFileDate(d) {
  return String(d || "").trim().slice(0, 10);
}

function locationIsTheCoveByName(name) {
  return String(name || "").trim().toLowerCase() === "the cove";
}

function displayedAmTips(allocation) {
  return (Number(allocation?.amTips) || 0) + (Number(allocation?.manualAmTips) || 0);
}

function displayedPmTips(allocation) {
  return (Number(allocation?.pmTips) || 0) + (Number(allocation?.manualPmTips) || 0);
}

function netTipsAfterDeductions(allocation) {
  const fin = Number(allocation?.finalTips ?? allocation?.totalTips) || 0;
  const share = Number(allocation?.redistributionShare) || 0;
  return Math.max(0, fin - share);
}

function sum(values) {
  return values.reduce((acc, n) => acc + (Number(n) || 0), 0);
}

const weeklyReportHeaders = (dateCols) => [
  "Employee",
  "Location",
  ...dateCols.map((c) => c.label),
  "Weekly Gross Tips",
  "Working hours",
  "Break hours",
  "Weekly Tardiness (min)",
  "Tardiness %",
  "Tardiness Deduction",
  "Weekly After Tardiness",
  "Manual Deduction",
  "Net Weekly Tips",
  "Tardiness Redistribution",
  "Final Weekly Tips Payable",
];

const REPORT_TYPES = [
  { id: "weekly_payout", label: "Weekly Payout" },
  { id: "weekly_tardiness", label: "Weekly Tardiness" },
  { id: "daily_tips", label: "Daily Tips" },
  { id: "production_pool", label: "Production Pool" },
];

export default function PayoutReports() {
  const { selectedLocationId, locations } = useApp();
  const defaultRange = useMemo(() => getDefaultDateRange(), []);
  const activeLocations = useMemo(
    () => locations.filter((loc) => loc.isActive !== false),
    [locations],
  );

  const [reportType, setReportType] = useState("weekly_payout");
  const [startDate, setStartDate] = useState(defaultRange.start);
  const [endDate, setEndDate] = useState(defaultRange.end);
  const [singleDate, setSingleDate] = useState(defaultRange.start);
  const [singleLocationId, setSingleLocationId] = useState(selectedLocationId || "");
  const [geographicScope, setGeographicScope] = useState("one_location");
  const [employeeScope, setEmployeeScope] = useState("all");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!singleLocationId && selectedLocationId) {
      setSingleLocationId(selectedLocationId);
    }
  }, [selectedLocationId, singleLocationId]);

  useEffect(() => {
    if (reportType !== "weekly_payout" || employeeScope !== "one_employee") {
      setEmployeeOptions([]);
      setSelectedEmployeeId("");
      return;
    }
    const sd = toFileDate(startDate);
    const ed = toFileDate(endDate);
    if (!sd || !ed || ed < sd) return;
    if (geographicScope === "one_location" && !singleLocationId) return;

    let cancelled = false;
    setLoadingEmployees(true);
    getWeeklyPayoutReportEmployees({
      startDate: sd,
      endDate: ed,
      geographicScope,
      ...(geographicScope === "one_location" ? { singleLocationId } : {}),
    })
      .then((res) => {
        if (cancelled) return;
        setEmployeeOptions(Array.isArray(res?.employees) ? res.employees : []);
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
  }, [reportType, employeeScope, startDate, endDate, geographicScope, singleLocationId]);

  const runWeeklyPayoutExport = useCallback(
    async (kind) => {
      const sd = toFileDate(startDate);
      const ed = toFileDate(endDate);
      if (!sd || !ed || ed < sd) {
        toast.error("Invalid date range");
        return;
      }
      if (geographicScope === "one_location" && !singleLocationId) {
        toast.error("Select location");
        return;
      }
      if (employeeScope === "one_employee" && !selectedEmployeeId) {
        toast.error("Select employee");
        return;
      }

      const scopeSummary =
        geographicScope === "all_locations"
          ? "All locations"
          : activeLocations.find((l) => l._id === singleLocationId)?.name || "One location";

      const body = {
        startDate: sd,
        endDate: ed,
        geographicScope,
        employeeScope,
        ...(geographicScope === "one_location" ? { singleLocationId } : {}),
        ...(employeeScope === "one_employee" ? { employeeId: selectedEmployeeId } : {}),
      };

      const reportData = await postWeeklyPayoutReport(body);
      const payouts = reportData?.payouts ?? [];
      if (!payouts.length) {
        toast.error("No data for export");
        return;
      }
      const cols =
        Array.isArray(reportData.dayDateKeys) && reportData.dayDateKeys.length > 0
          ? columnsFromDayDateKeys(reportData.dayDateKeys)
          : getDateRangeColumns(sd, ed);
      const hdr = weeklyReportHeaders(cols);
      const exportMeta = buildWeeklyPayoutExportMeta(sd, ed, scopeSummary);
      const oneLocationLabel =
        geographicScope === "one_location"
          ? activeLocations.find((l) => String(l._id) === String(singleLocationId))?.name ||
            payouts[0]?.locationName ||
            "location"
          : "";
      const scopeSlug =
        geographicScope === "all_locations" ? "all-locations" : sanitizeExportSlug(oneLocationLabel);
      const empSlug =
        employeeScope === "one_employee" ? `emp-${String(selectedEmployeeId).slice(0, 12)}` : "all-employees";
      const fileBase = `weekly-payout-report-${scopeSlug}-${empSlug}-${sd}-${ed}`;
      const forCsv = kind === "csv";
      const allLocationsAllEmployees =
        geographicScope === "all_locations" && employeeScope !== "one_employee";

      if (allLocationsAllEmployees) {
        const groups = groupPayoutsByLocationDisplayOrder(payouts, activeLocations);
        const sections = groups.map((g) => ({
          sectionTitle: g.label,
          headers: hdr,
          rows: (() => {
            const rows = g.payouts.map((p) =>
              payoutToExportRow(p, p.locationName ?? g.label, cols, forCsv),
            );
            const dayTotals = cols.map((_, idx) =>
              sum(g.payouts.map((p) => (p.dailyTipsByDay || [])[idx] ?? 0)),
            );
            rows.push([
              "Total",
              g.label,
              ...dayTotals.map((v) =>
                forCsv ? formatCsvNumeric(v, { maxFractionDigits: 2 }) : formatMoney(v),
              ),
              forCsv
                ? formatCsvNumeric(sum(g.payouts.map((p) => p.weeklyGrossTips ?? p.dailyTipsMonToSun)), { maxFractionDigits: 2 })
                : formatMoney(sum(g.payouts.map((p) => p.weeklyGrossTips ?? p.dailyTipsMonToSun))),
              formatDurationForReport(sum(g.payouts.map((p) => p.totalWorkingMinutes))),
              formatDurationForReport(sum(g.payouts.map((p) => breakMinutesFromPayout(p)))),
              String(sum(g.payouts.map((p) => p.weeklyTardinessMinutes))),
              "",
              forCsv ? formatCsvNumeric(sum(g.payouts.map((p) => p.tardinessDeduction)), { maxFractionDigits: 2 }) : formatMoney(sum(g.payouts.map((p) => p.tardinessDeduction))),
              forCsv ? formatCsvNumeric(sum(g.payouts.map((p) => p.weeklyAfterTardiness)), { maxFractionDigits: 2 }) : formatMoney(sum(g.payouts.map((p) => p.weeklyAfterTardiness))),
              forCsv ? formatCsvNumeric(sum(g.payouts.map((p) => p.manualDeduction)), { maxFractionDigits: 2 }) : formatMoney(sum(g.payouts.map((p) => p.manualDeduction))),
              forCsv ? formatCsvNumeric(sum(g.payouts.map((p) => p.netWeeklyTips)), { maxFractionDigits: 2 }) : formatMoney(sum(g.payouts.map((p) => p.netWeeklyTips))),
              forCsv ? formatCsvNumeric(sum(g.payouts.map((p) => p.tardinessRedistribution)), { maxFractionDigits: 2 }) : formatMoney(sum(g.payouts.map((p) => p.tardinessRedistribution))),
              forCsv ? formatCsvNumeric(sum(g.payouts.map((p) => p.finalWeeklyTipsPayable)), { maxFractionDigits: 2 }) : formatMoney(sum(g.payouts.map((p) => p.finalWeeklyTipsPayable))),
            ]);
            return rows;
          })(),
        }));
        if (kind === "csv") {
          exportSectionedTableToCSV(exportMeta.csvMetaLines, sections, `${fileBase}.csv`);
        } else {
          exportSectionedTableToPDF("", sections, `${fileBase}.pdf`, {
            headFillColor: PDF_HEAD_INDIGO,
            weeklyPayoutHeader: exportMeta.weeklyPayoutHeader,
          });
        }
      } else {
        const rows = payouts.map((p) => payoutToExportRow(p, p.locationName ?? "-", cols, forCsv));
        if (employeeScope !== "one_employee") {
          const dayTotals = cols.map((_, idx) =>
            sum(payouts.map((p) => (p.dailyTipsByDay || [])[idx] ?? 0)),
          );
          rows.push([
            "Total",
            geographicScope === "one_location" ? oneLocationLabel || "-" : "All locations",
            ...dayTotals.map((v) =>
              forCsv ? formatCsvNumeric(v, { maxFractionDigits: 2 }) : formatMoney(v),
            ),
            forCsv
              ? formatCsvNumeric(sum(payouts.map((p) => p.weeklyGrossTips ?? p.dailyTipsMonToSun)), { maxFractionDigits: 2 })
              : formatMoney(sum(payouts.map((p) => p.weeklyGrossTips ?? p.dailyTipsMonToSun))),
            formatDurationForReport(sum(payouts.map((p) => p.totalWorkingMinutes))),
            formatDurationForReport(sum(payouts.map((p) => breakMinutesFromPayout(p)))),
            String(sum(payouts.map((p) => p.weeklyTardinessMinutes))),
            "",
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.tardinessDeduction)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.tardinessDeduction))),
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.weeklyAfterTardiness)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.weeklyAfterTardiness))),
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.manualDeduction)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.manualDeduction))),
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.netWeeklyTips)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.netWeeklyTips))),
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.tardinessRedistribution)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.tardinessRedistribution))),
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.finalWeeklyTipsPayable)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.finalWeeklyTipsPayable))),
          ]);
        }
        if (kind === "csv") {
          exportTableToCSV(hdr, rows, `${fileBase}.csv`);
        } else if (employeeScope === "one_employee") {
          const employeeLabel = employeeOptions.find((e) => e.employeeId === selectedEmployeeId)?.employeeName || selectedEmployeeId;
          exportSingleEmployeeWeeklyPayoutPDF({
            headers: hdr,
            rows,
            filename: `${fileBase}.pdf`,
            searchQuery: employeeLabel,
            periodLabel: `${sd} - ${ed}`,
            scopeLabel: scopeSummary,
            payouts,
          });
        } else {
          exportTableToPDF("", hdr, rows, `${fileBase}.pdf`, {
            headFillColor: PDF_HEAD_INDIGO,
            weeklyPayoutHeader: exportMeta.weeklyPayoutHeader,
          });
        }
      }
    },
    [
      startDate,
      endDate,
      geographicScope,
      singleLocationId,
      employeeScope,
      selectedEmployeeId,
      activeLocations,
      employeeOptions,
    ],
  );

  const runWeeklyTardinessExport = useCallback(
    async (kind) => {
      const sd = toFileDate(startDate);
      const ed = toFileDate(endDate);
      if (!sd || !ed || ed < sd) {
        toast.error("Invalid date range");
        return;
      }
      const result = await getWeeklyTardiness(sd, singleLocationId || null, false, sd, ed);
      const entries = result?.entries ?? [];
      const dateColumns = getDateRangeColumns(sd, ed);
      const employeeMap = new Map();
      for (const row of entries) {
        const key = row.employeeName;
        if (!employeeMap.has(key)) employeeMap.set(key, { employeeName: key, byDate: {} });
        const rec = employeeMap.get(key);
        const d = String(row.date ?? "").trim().slice(0, 10);
        const mins = Math.max(0, Number(row.minutesLate) || 0);
        const clockInMins = timeToMinutes(row.clockIn);
        if (!rec.byDate[d] || clockInMins < rec.byDate[d]._earliestMins) {
          rec.byDate[d] = {
            locationName: row.locationName || "—",
            minutesLate: mins,
            scheduledTime: row.scheduledTime,
            clockIn: row.clockIn,
            _earliestMins: clockInMins,
          };
        }
      }
      employeeMap.forEach((rec) => {
        Object.keys(rec.byDate || {}).forEach((d) => delete rec.byDate[d]._earliestMins);
      });
      const employeeRows = Array.from(employeeMap.values()).sort((a, b) =>
        a.employeeName.localeCompare(b.employeeName),
      );
      const headers = [
        "Employee",
        ...dateColumns.map((c) => c.label),
        "Total (min)",
        "Working hours",
        "Break hours",
      ];
      const formatDayCell = (dayRec) => {
        const loc = dayRec?.locationName ?? "—";
        const s = String(dayRec?.scheduledTime ?? "").trim();
        const c = String(dayRec?.clockIn ?? "").trim();
        const minutes = s && s === c ? 0 : Math.max(0, Number(dayRec?.minutesLate) || 0);
        if (minutes > 0) return `${loc} ${dayRec?.scheduledTime ?? "–"} -> ${dayRec?.clockIn ?? "–"} ${minutes} min`;
        return `${loc} -`;
      };
      const rows = employeeRows.map((rec) => {
        const rowTotal = dateColumns.reduce((sum, col) => {
          const dayRec = rec.byDate[col.dateKey];
          const s = String(dayRec?.scheduledTime ?? "").trim();
          const c = String(dayRec?.clockIn ?? "").trim();
          const mins = s && s === c ? 0 : Math.max(0, Number(dayRec?.minutesLate) || 0);
          return sum + mins;
        }, 0);
        const working = Number(result?.totalWorkingMinutesByEmployee?.[rec.employeeName]) || 0;
        const breaks = Number(result?.totalBreakMinutesByEmployee?.[rec.employeeName]) || 0;
        return [
          rec.employeeName,
          ...dateColumns.map((col) => formatDayCell(rec.byDate[col.dateKey])),
          String(rowTotal),
          formatDurationForReport(working),
          formatDurationForReport(breaks),
        ];
      });
      const totalsByDate = {};
      dateColumns.forEach((c) => {
        totalsByDate[c.dateKey] = 0;
      });
      employeeRows.forEach((rec) => {
        dateColumns.forEach((col) => {
          const dayRec = rec.byDate[col.dateKey];
          const s = String(dayRec?.scheduledTime ?? "").trim();
          const c = String(dayRec?.clockIn ?? "").trim();
          const mins = s && s === c ? 0 : Math.max(0, Number(dayRec?.minutesLate) || 0);
          totalsByDate[col.dateKey] += mins;
        });
      });
      rows.push([
        "Total",
        ...dateColumns.map((col) => `${totalsByDate[col.dateKey] ?? 0} min`),
        String(sum(Object.values(totalsByDate))),
        formatDurationForReport(sum(employeeRows.map((rec) => Number(result?.totalWorkingMinutesByEmployee?.[rec.employeeName]) || 0))),
        formatDurationForReport(sum(employeeRows.map((rec) => Number(result?.totalBreakMinutesByEmployee?.[rec.employeeName]) || 0))),
      ]);
      const locSlug = singleLocationId
        ? sanitizeExportSlug(activeLocations.find((l) => l._id === singleLocationId)?.name)
        : "all-locations";
      const file = `weekly-tardiness-${locSlug}-${sd}-${ed}.${kind}`;
      if (kind === "csv") {
        exportTableToCSV(headers, rows, file);
      } else {
        exportTableToPDF(`Weekly Tardiness ${sd} ${ed}`, headers, rows, file);
      }
    },
    [startDate, endDate, singleLocationId, activeLocations],
  );

  const runDailyTipsExport = useCallback(
    async (kind) => {
      const d = toFileDate(singleDate);
      if (!d || !singleLocationId) {
        toast.error("Select location and date");
        return;
      }
      const calc = await getDailyTipCalculation(singleLocationId, d, { refresh: false });
      const allocations = (calc?.employeeAllocations ?? [])
        .slice()
        .sort((a, b) => (a.employeeName || "").localeCompare(b.employeeName || "", undefined, { sensitivity: "base" }));
      if (!allocations.length) {
        toast.error("No daily tips rows for export");
        return;
      }
      const isCove = locationIsTheCoveByName(activeLocations.find((l) => l._id === singleLocationId)?.name);
      const showShiftSplit = !isCove;
      const headers = showShiftSplit
        ? ["Employee", "Clock In", "Clock Out", "Break In", "Break Out", "Break (hrs)", "AM hrs", "PM hrs", "AM tips", "PM tips", "Net tips", "Manual Redistribution", "Total"]
        : ["Employee", "Clock In", "Clock Out", "Break In", "Break Out", "Break (hrs)", "Hours", "Tips", "Net tips", "Manual Redistribution", "Total"];
      const rows = allocations.map((a) =>
        showShiftSplit
          ? [
              a.employeeName ?? "",
              a.clockIn ?? "–",
              a.clockOut ?? "–",
              a.breakClockIn ?? "–",
              a.breakClockOut ?? "–",
              kind === "csv" ? formatCsvNumeric(a.connecteamBreakHours ?? "", { maxFractionDigits: 3 }) : Number(a.connecteamBreakHours || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(a.amWorkedHours ?? "", { maxFractionDigits: 3 }) : Number(a.amWorkedHours || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(a.pmWorkedHours ?? "", { maxFractionDigits: 3 }) : Number(a.pmWorkedHours || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(displayedAmTips(a), { maxFractionDigits: 3 }) : `$${displayedAmTips(a).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(displayedPmTips(a), { maxFractionDigits: 3 }) : `$${displayedPmTips(a).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(netTipsAfterDeductions(a), { maxFractionDigits: 3 }) : `$${netTipsAfterDeductions(a).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(Number(a.redistributionShare ?? 0), { maxFractionDigits: 3 }) : `$${Number(a.redistributionShare ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(Number(a.finalTips ?? a.totalTips), { maxFractionDigits: 3 }) : `$${Number(a.finalTips ?? a.totalTips).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
            ]
          : [
              a.employeeName ?? "",
              a.clockIn ?? "–",
              a.clockOut ?? "–",
              a.breakClockIn ?? "–",
              a.breakClockOut ?? "–",
              kind === "csv" ? formatCsvNumeric(a.connecteamBreakHours ?? "", { maxFractionDigits: 3 }) : Number(a.connecteamBreakHours || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(a.amWorkedHours ?? "", { maxFractionDigits: 3 }) : Number(a.amWorkedHours || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(displayedAmTips(a), { maxFractionDigits: 3 }) : `$${displayedAmTips(a).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(netTipsAfterDeductions(a), { maxFractionDigits: 3 }) : `$${netTipsAfterDeductions(a).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(Number(a.redistributionShare ?? 0), { maxFractionDigits: 3 }) : `$${Number(a.redistributionShare ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(Number(a.finalTips ?? a.totalTips), { maxFractionDigits: 3 }) : `$${Number(a.finalTips ?? a.totalTips).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
            ],
      );
      const totals = allocations.reduce(
        (acc, a) => ({
          amWorkedHours: acc.amWorkedHours + (Number(a.amWorkedHours) || 0),
          pmWorkedHours: acc.pmWorkedHours + (Number(a.pmWorkedHours) || 0),
          connecteamBreakHours:
            acc.connecteamBreakHours + (Number(a.connecteamBreakHours) || 0),
          amTips: acc.amTips + displayedAmTips(a),
          pmTips: acc.pmTips + displayedPmTips(a),
          netTips: acc.netTips + netTipsAfterDeductions(a),
          redistributionShare:
            acc.redistributionShare + (Number(a.redistributionShare) || 0),
          totalTips: acc.totalTips + (Number(a.finalTips ?? a.totalTips) || 0),
        }),
        {
          amWorkedHours: 0,
          pmWorkedHours: 0,
          connecteamBreakHours: 0,
          amTips: 0,
          pmTips: 0,
          netTips: 0,
          redistributionShare: 0,
          totalTips: 0,
        },
      );
      const summaryRows = [
        [
          "Summary",
          `AM gross: ${kind === "csv" ? formatCsvNumeric(calc?.inputs?.amGrossTips, { maxFractionDigits: 3 }) : formatMoney(calc?.inputs?.amGrossTips || 0)}`,
          `PM gross: ${kind === "csv" ? formatCsvNumeric(calc?.inputs?.pmGrossTips, { maxFractionDigits: 3 }) : formatMoney(calc?.inputs?.pmGrossTips || 0)}`,
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
        ].slice(0, headers.length),
      ];
      rows.unshift(...summaryRows);
      rows.push(
        showShiftSplit
          ? [
              "Total",
              "",
              "",
              "",
              "",
              kind === "csv" ? formatCsvNumeric(totals.connecteamBreakHours, { maxFractionDigits: 3 }) : totals.connecteamBreakHours.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(totals.amWorkedHours, { maxFractionDigits: 3 }) : totals.amWorkedHours.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(totals.pmWorkedHours, { maxFractionDigits: 3 }) : totals.pmWorkedHours.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(totals.amTips, { maxFractionDigits: 3 }) : `$${totals.amTips.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(totals.pmTips, { maxFractionDigits: 3 }) : `$${totals.pmTips.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(totals.netTips, { maxFractionDigits: 3 }) : `$${totals.netTips.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(totals.redistributionShare, { maxFractionDigits: 3 }) : `$${totals.redistributionShare.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(totals.totalTips, { maxFractionDigits: 3 }) : `$${totals.totalTips.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
            ]
          : [
              "Total",
              "",
              "",
              "",
              "",
              kind === "csv" ? formatCsvNumeric(totals.connecteamBreakHours, { maxFractionDigits: 3 }) : totals.connecteamBreakHours.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(totals.amWorkedHours, { maxFractionDigits: 3 }) : totals.amWorkedHours.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" }),
              kind === "csv" ? formatCsvNumeric(totals.amTips, { maxFractionDigits: 3 }) : `$${totals.amTips.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(totals.netTips, { maxFractionDigits: 3 }) : `$${totals.netTips.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(totals.redistributionShare, { maxFractionDigits: 3 }) : `$${totals.redistributionShare.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
              kind === "csv" ? formatCsvNumeric(totals.totalTips, { maxFractionDigits: 3 }) : `$${totals.totalTips.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3, roundingMode: "trunc" })}`,
            ],
      );
      const locName = activeLocations.find((l) => l._id === singleLocationId)?.name || "location";
      const file = `daily-tips-${sanitizeExportSlug(locName)}-${d}.${kind}`;
      if (kind === "csv") {
        exportTableToCSV(headers, rows, file);
      } else {
        exportTableToPDF(`Daily Tips ${locName} ${d}`, headers, rows, file);
      }
    },
    [singleDate, singleLocationId, activeLocations],
  );

  const runProductionPoolExport = useCallback(
    async (kind) => {
      const sd = toFileDate(startDate);
      const ed = toFileDate(endDate);
      if (!sd || !ed || ed < sd) {
        toast.error("Invalid date range");
        return;
      }
      const [res, locationList] = await Promise.all([
        getWeeklyProductionPayout(sd, sd, ed),
        getLocationWiseProductionPool(sd, sd, ed),
      ]);
      const payouts = res?.payouts ?? [];
      const locationWisePool = Array.isArray(locationList) ? locationList : [];
      if (!payouts.length) {
        toast.error("No production pool data for export");
        return;
      }
      const dateCols = res?.dateRange
        ? getDateRangeColumns(res.dateRange.startDate, res.dateRange.endDate)
        : getDateRangeColumns(sd, ed);
      const totalPoolFromLocations = locationWisePool.reduce(
        (sum, row) => sum + (Number(row.weeklyPool) || 0),
        0,
      );
      const payoutHeaders = [
        "Employee",
        "Allocation %",
        "Gross Production Tips",
        "Weekly Tardiness (min)",
        "Tardiness %",
        "Tardiness Deduction",
        "Manual Deduction",
        "Redistribution Received",
        "Final Weekly Production Payout",
      ];
      const payoutRows = payouts.map((p) => [
        p.name + (p.subjectToTardiness === false ? " (exempt)" : ""),
        `${p.allocationPercent ?? 0}%`,
        kind === "csv" ? formatCsvNumeric(p.weeklyGrossProductionTips, { maxFractionDigits: 2 }) : formatMoney(p.weeklyGrossProductionTips),
        String(p.weeklyTardinessMinutes ?? 0),
        `${p.tardinessPercent ?? 0}%`,
        kind === "csv" ? formatCsvNumeric(p.tardinessDeduction, { maxFractionDigits: 2 }) : formatMoney(p.tardinessDeduction),
        kind === "csv" ? formatCsvNumeric(p.manualDeduction, { maxFractionDigits: 2 }) : formatMoney(p.manualDeduction),
        kind === "csv" ? formatCsvNumeric(p.tardinessRedistribution ?? 0, { maxFractionDigits: 2 }) : formatMoney(p.tardinessRedistribution ?? 0),
        kind === "csv" ? formatCsvNumeric(p.finalWeeklyProductionPayout ?? 0, { maxFractionDigits: 2 }) : formatMoney(p.finalWeeklyProductionPayout ?? 0),
      ]);
      payoutRows.push([
        "Total",
        "",
        kind === "csv" ? formatCsvNumeric(sum(payouts.map((p) => p.weeklyGrossProductionTips)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.weeklyGrossProductionTips))),
        String(sum(payouts.map((p) => p.weeklyTardinessMinutes))),
        "",
        kind === "csv" ? formatCsvNumeric(sum(payouts.map((p) => p.tardinessDeduction)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.tardinessDeduction))),
        kind === "csv" ? formatCsvNumeric(sum(payouts.map((p) => p.manualDeduction)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.manualDeduction)),
        ),
        kind === "csv" ? formatCsvNumeric(sum(payouts.map((p) => p.tardinessRedistribution ?? 0)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.tardinessRedistribution ?? 0))),
        kind === "csv" ? formatCsvNumeric(sum(payouts.map((p) => p.finalWeeklyProductionPayout ?? 0)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.finalWeeklyProductionPayout ?? 0))),
      ]);
      const locationHeaders = ["Location", ...dateCols.map((c) => c.label), "Weekly total"];
      const locationRows = locationWisePool.map((row) => [
        row.locationName ?? "",
        ...dateCols.map((_, i) =>
          kind === "csv"
            ? formatCsvNumeric((row.dailyByDay || [])[i] ?? 0, { maxFractionDigits: 2 })
            : formatMoney((row.dailyByDay || [])[i] ?? 0),
        ),
        kind === "csv" ? formatCsvNumeric(row.weeklyPool ?? 0, { maxFractionDigits: 2 }) : formatMoney(row.weeklyPool ?? 0),
      ]);
      if (locationWisePool.length > 0) {
        locationRows.push([
          "Total",
          ...dateCols.map((_, i) =>
            kind === "csv"
              ? formatCsvNumeric(
                  locationWisePool.reduce((s, row) => s + (Number((row.dailyByDay || [])[i]) || 0), 0),
                  { maxFractionDigits: 2 },
                )
              : formatMoney(
                  locationWisePool.reduce((s, row) => s + (Number((row.dailyByDay || [])[i]) || 0), 0),
                ),
          ),
          kind === "csv" ? formatCsvNumeric(totalPoolFromLocations, { maxFractionDigits: 2 }) : formatMoney(totalPoolFromLocations),
        ]);
      }
      const file = `production-pool-${sd}-${ed}.${kind}`;
      if (kind === "csv") {
        exportMultiTableToCSV(
          [
            { headers: payoutHeaders, rows: payoutRows },
            { headers: locationHeaders, rows: locationRows },
          ],
          file,
        );
      } else {
        exportMultiTableToPDF(
          `Production Pool ${sd} ${ed}`,
          [
            { headers: payoutHeaders, rows: payoutRows },
            { headers: locationHeaders, rows: locationRows },
          ],
          file,
        );
      }
    },
    [startDate, endDate],
  );

  const runExport = useCallback(
    async (kind) => {
      setExporting(true);
      try {
        if (reportType === "weekly_payout") await runWeeklyPayoutExport(kind);
        if (reportType === "weekly_tardiness") await runWeeklyTardinessExport(kind);
        if (reportType === "daily_tips") await runDailyTipsExport(kind);
        if (reportType === "production_pool") await runProductionPoolExport(kind);
      } catch (err) {
        toast.error(err?.response?.data?.error || err?.message || "Export failed");
      } finally {
        setExporting(false);
      }
    },
    [reportType, runWeeklyPayoutExport, runWeeklyTardinessExport, runDailyTipsExport, runProductionPoolExport],
  );

  return (
    <div className="space-y-4 pb-6">
      <h1 className="text-2xl font-bold text-slate-900">Reports</h1>

      <Card className="border-slate-300 bg-gray-100 p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Report type
            </label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {REPORT_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {reportType === "daily_tips" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Date
              </label>
              <input
                type="date"
                value={singleDate}
                onChange={(e) => setSingleDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  From
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  To
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                />
              </div>
            </>
          )}

          {(reportType === "daily_tips" || reportType === "weekly_tardiness") && (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Location
              </label>
              <select
                value={singleLocationId}
                onChange={(e) => setSingleLocationId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                {reportType === "weekly_tardiness" && <option value="">All locations</option>}
                <option value="">Select location…</option>
                {activeLocations.map((loc) => (
                  <option key={loc._id} value={loc._id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      {reportType === "weekly_payout" && (
        <Card className="border-slate-300 bg-gray-100 p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Location scope
              </label>
              <select
                value={geographicScope}
                onChange={(e) => setGeographicScope(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                <option value="one_location">One location</option>
                <option value="all_locations">All locations</option>
              </select>
            </div>
            {geographicScope === "one_location" && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Location
                </label>
                <select
                  value={singleLocationId}
                  onChange={(e) => setSingleLocationId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
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
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Employee scope
              </label>
              <select
                value={employeeScope}
                onChange={(e) => {
                  setEmployeeScope(e.target.value);
                  setSelectedEmployeeId("");
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                <option value="all">All employees</option>
                <option value="one_employee">One employee</option>
              </select>
            </div>
            {employeeScope === "one_employee" && (
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Employee
                </label>
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  disabled={loadingEmployees}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-60"
                >
                  <option value="">
                    {loadingEmployees ? "Loading employees…" : "Select employee…"}
                  </option>
                  {employeeOptions.map((e) => (
                    <option key={`${e.locationId}-${e.employeeId}`} value={e.employeeId}>
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
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" disabled={exporting} onClick={() => runExport("csv")}>
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
        <Button type="button" disabled={exporting} onClick={() => runExport("pdf")}>
          {exporting ? "Exporting…" : "Export PDF"}
        </Button>
      </div>
    </div>
  );
}
