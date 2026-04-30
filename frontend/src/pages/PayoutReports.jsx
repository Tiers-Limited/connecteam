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
import {
  getDailyTipCalculation,
  getDailyTipsHistory,
  getWeeklyFinalPayableSummary,
} from "../services/dailyTipService";
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
import {
  FiCalendar,
  FiChevronRight,
  FiDownload,
  FiFileText,
  FiMapPin,
  FiTrendingUp,
  FiUser,
} from "react-icons/fi";

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
    fmtMoney(p.additionalTips ?? 0),
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

function parseWeeklyPayoutEmployeeSelection(value) {
  const raw = String(value || "");
  if (raw.startsWith("id:")) return { employeeId: raw.slice(3), employeeName: "" };
  if (raw.startsWith("name:")) return { employeeId: "", employeeName: raw.slice(5) };
  return { employeeId: raw, employeeName: "" };
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
  "Additional Tips (+)",
  "Net Weekly Tips",
  "Tardiness Redistribution",
  "Final Weekly Tips Payable",
];

const REPORT_TYPES = [
  { id: "weekly_payout", label: "Weekly Payout" },
  { id: "weekly_tardiness", label: "Weekly Tardiness" },
  { id: "weekly_final_payable_total", label: "Weekly Final Payable Total" },
  { id: "daily_tips", label: "Daily Tips" },
  { id: "tip_history", label: "Tip History" },
  { id: "production_pool", label: "Production Pool" },
];

const REPORT_TYPE_STYLES = {
  weekly_payout: {
    accent: "from-indigo-500 via-violet-500 to-fuchsia-500",
    ring: "ring-indigo-300",
    icon: FiTrendingUp,
  },
  weekly_tardiness: {
    accent: "from-amber-500 via-orange-500 to-rose-500",
    ring: "ring-amber-300",
    icon: FiCalendar,
  },
  weekly_final_payable_total: {
    accent: "from-fuchsia-500 via-violet-500 to-indigo-500",
    ring: "ring-fuchsia-300",
    icon: FiTrendingUp,
  },
  daily_tips: {
    accent: "from-emerald-500 via-teal-500 to-cyan-500",
    ring: "ring-emerald-300",
    icon: FiFileText,
  },
  tip_history: {
    accent: "from-violet-500 via-purple-500 to-indigo-500",
    ring: "ring-violet-300",
    icon: FiFileText,
  },
  production_pool: {
    accent: "from-sky-500 via-indigo-500 to-purple-500",
    ring: "ring-sky-300",
    icon: FiDownload,
  },
};

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
  const [tardinessGeographicScope, setTardinessGeographicScope] = useState("one_location");
  const [tardinessEmployeeScope, setTardinessEmployeeScope] = useState("all");
  const [tardinessSelectedEmployee, setTardinessSelectedEmployee] = useState("");
  const [tardinessEmployeeOptions, setTardinessEmployeeOptions] = useState([]);
  const [loadingTardinessEmployees, setLoadingTardinessEmployees] = useState(false);
  const [exportLoadingKind, setExportLoadingKind] = useState(null);
  const firstActiveLocationId = activeLocations[0]?._id || "";
  const weeklyPayoutEmployeeOptions = useMemo(() => {
    const list = Array.isArray(employeeOptions) ? employeeOptions : [];
    if (geographicScope === "all_locations") {
      const byName = new Map();
      for (const row of list) {
        const name = String(row?.employeeName || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!byName.has(key)) {
          byName.set(key, {
            value: `name:${name}`,
            employeeName: name,
            label: name,
          });
        }
      }
      return Array.from(byName.values()).sort((a, b) =>
        a.employeeName.localeCompare(b.employeeName, undefined, { sensitivity: "base" }),
      );
    }
    return list
      .map((row) => {
        const employeeId = String(row?.employeeId || "").trim();
        const employeeName = String(row?.employeeName || "").trim();
        const locationName = String(row?.locationName || "").trim();
        if (!employeeName && !employeeId) return null;
        return {
          value: employeeId ? `id:${employeeId}` : `name:${employeeName}`,
          employeeName,
          label: employeeName || employeeId,
          locationName,
        };
      })
      .filter(Boolean)
      .sort((a, b) =>
        (a.employeeName || "").localeCompare(b.employeeName || "", undefined, {
          sensitivity: "base",
        }),
      );
  }, [employeeOptions, geographicScope]);

  useEffect(() => {
    if (singleLocationId) return;
    if (selectedLocationId && activeLocations.some((l) => l._id === selectedLocationId)) {
      setSingleLocationId(selectedLocationId);
      return;
    }
    if (firstActiveLocationId) {
      setSingleLocationId(firstActiveLocationId);
    }
  }, [selectedLocationId, singleLocationId, activeLocations, firstActiveLocationId]);

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

  useEffect(() => {
    if (reportType !== "weekly_tardiness" || tardinessEmployeeScope !== "one_employee") {
      setTardinessEmployeeOptions([]);
      setTardinessSelectedEmployee("");
      return;
    }
    const sd = toFileDate(startDate);
    const ed = toFileDate(endDate);
    if (!sd || !ed || ed < sd) return;
    let cancelled = false;
    setLoadingTardinessEmployees(true);
    getWeeklyTardiness(
      sd,
      tardinessGeographicScope === "one_location" ? singleLocationId || null : null,
      false,
      sd,
      ed,
    )
      .then((result) => {
        if (cancelled) return;
        const options = Array.from(
          new Set(
            (result?.entries || [])
              .map((r) => String(r?.employeeName || "").trim())
              .filter(Boolean),
          ),
        ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        setTardinessEmployeeOptions(options);
      })
      .catch(() => {
        if (!cancelled) setTardinessEmployeeOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingTardinessEmployees(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    reportType,
    tardinessEmployeeScope,
    startDate,
    endDate,
    tardinessGeographicScope,
    singleLocationId,
  ]);

  useEffect(() => {
    if (employeeScope !== "one_employee") {
      if (selectedEmployeeId) setSelectedEmployeeId("");
      return;
    }
    if (!weeklyPayoutEmployeeOptions.length) {
      if (selectedEmployeeId) setSelectedEmployeeId("");
      return;
    }
    if (weeklyPayoutEmployeeOptions.some((o) => o.value === selectedEmployeeId)) return;
    setSelectedEmployeeId(weeklyPayoutEmployeeOptions[0].value);
  }, [employeeScope, weeklyPayoutEmployeeOptions, selectedEmployeeId]);

  useEffect(() => {
    if (tardinessEmployeeScope !== "one_employee") return;
    if (!tardinessEmployeeOptions.length) {
      if (tardinessSelectedEmployee) setTardinessSelectedEmployee("");
      return;
    }
    if (tardinessEmployeeOptions.includes(tardinessSelectedEmployee)) return;
    setTardinessSelectedEmployee(tardinessEmployeeOptions[0]);
  }, [tardinessEmployeeScope, tardinessEmployeeOptions, tardinessSelectedEmployee]);

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
      const selectedEmployeeFilter = parseWeeklyPayoutEmployeeSelection(selectedEmployeeId);

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
        ...(employeeScope === "one_employee"
          ? selectedEmployeeFilter.employeeId
            ? { employeeId: selectedEmployeeFilter.employeeId }
            : { employeeName: selectedEmployeeFilter.employeeName }
          : {}),
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
        employeeScope === "one_employee"
          ? `emp-${sanitizeExportSlug(
              selectedEmployeeFilter.employeeName || selectedEmployeeFilter.employeeId,
            )}`
          : "all-employees";
      const fileBase = `weekly-payout-report-${scopeSlug}-${empSlug}-${sd}-${ed}`;
      const forCsv = kind === "csv";
      const allLocationsAllEmployees =
        geographicScope === "all_locations" && employeeScope !== "one_employee";
      const allLocationsOneEmployee =
        geographicScope === "all_locations" && employeeScope === "one_employee";

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
              forCsv ? formatCsvNumeric(sum(g.payouts.map((p) => p.additionalTips ?? 0)), { maxFractionDigits: 2 }) : formatMoney(sum(g.payouts.map((p) => p.additionalTips ?? 0))),
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
      } else if (allLocationsOneEmployee) {
        const timelineRows = [];
        cols.forEach((col, idx) => {
          payouts.forEach((p) => {
            const amount = Number((p.dailyTipsByDay || [])[idx] ?? 0);
            if (amount <= 0) return;
            timelineRows.push({
              dateLabel: col.label,
              dateKey: col.dateKey || String(idx),
              locationName: p.locationName || "-",
              amount,
            });
          });
        });
        timelineRows.sort((a, b) => {
          if (a.dateKey !== b.dateKey) return String(a.dateKey).localeCompare(String(b.dateKey));
          return String(a.locationName).localeCompare(String(b.locationName), undefined, {
            sensitivity: "base",
          });
        });
        const timelineHeaders = ["Date", "Tips", "Location"];
        const timelineBody = timelineRows.map((r) => [
          r.dateLabel,
          forCsv ? formatCsvNumeric(r.amount, { maxFractionDigits: 2 }) : formatMoney(r.amount),
          r.locationName,
        ]);
        const totalAmount = sum(timelineRows.map((r) => r.amount));
        const totalWeeklyGrossTips = sum(
          payouts.map((p) => p.weeklyGrossTips ?? p.dailyTipsMonToSun),
        );
        const totalWorkingMinutes = sum(payouts.map((p) => p.totalWorkingMinutes));
        const totalBreakMinutes = sum(payouts.map((p) => breakMinutesFromPayout(p)));
        const totalWeeklyTardinessMinutes = sum(
          payouts.map((p) => p.weeklyTardinessMinutes),
        );
        const totalTardinessDeduction = sum(payouts.map((p) => p.tardinessDeduction));
        const totalWeeklyAfterTardiness = sum(
          payouts.map((p) => p.weeklyAfterTardiness),
        );
        const totalManualDeduction = sum(payouts.map((p) => p.manualDeduction));
        const totalAdditionalTips = sum(payouts.map((p) => p.additionalTips ?? 0));
        const totalNetWeeklyTips = sum(payouts.map((p) => p.netWeeklyTips));
        const totalTardinessRedistribution = sum(
          payouts.map((p) => p.tardinessRedistribution ?? 0),
        );
        const totalFinalWeeklyTipsPayable = sum(
          payouts.map((p) => p.finalWeeklyTipsPayable ?? 0),
        );
        const mergedTardinessPercent =
          totalWeeklyGrossTips > 0
            ? `${((totalTardinessDeduction / totalWeeklyGrossTips) * 100).toFixed(2)}%`
            : "0%";
        timelineBody.push([
          "Total",
          forCsv
            ? formatCsvNumeric(totalAmount, { maxFractionDigits: 2 })
            : formatMoney(totalAmount),
          "All locations",
        ]);
        timelineBody.push(["", "", ""]);
        timelineBody.push([
          "Weekly Gross Tips",
          forCsv
            ? formatCsvNumeric(totalWeeklyGrossTips, { maxFractionDigits: 2 })
            : formatMoney(totalWeeklyGrossTips),
          "",
        ]);
        timelineBody.push([
          "Working hours",
          formatDurationForReport(totalWorkingMinutes),
          "",
        ]);
        timelineBody.push([
          "Break hours",
          formatDurationForReport(totalBreakMinutes),
          "",
        ]);
        timelineBody.push([
          "Weekly Tardiness (min)",
          String(totalWeeklyTardinessMinutes),
          "",
        ]);
        timelineBody.push(["Tardiness %", mergedTardinessPercent, ""]);
        timelineBody.push([
          "Tardiness Deduction",
          forCsv
            ? formatCsvNumeric(totalTardinessDeduction, { maxFractionDigits: 2 })
            : formatMoney(totalTardinessDeduction),
          "",
        ]);
        timelineBody.push([
          "Weekly After Tardiness",
          forCsv
            ? formatCsvNumeric(totalWeeklyAfterTardiness, { maxFractionDigits: 2 })
            : formatMoney(totalWeeklyAfterTardiness),
          "",
        ]);
        timelineBody.push([
          "Manual Deduction",
          forCsv
            ? formatCsvNumeric(totalManualDeduction, { maxFractionDigits: 2 })
            : formatMoney(totalManualDeduction),
          "",
        ]);
        timelineBody.push([
          "Additional Tips (+)",
          forCsv
            ? formatCsvNumeric(totalAdditionalTips, { maxFractionDigits: 2 })
            : formatMoney(totalAdditionalTips),
          "",
        ]);
        timelineBody.push([
          "Net Weekly Tips",
          forCsv
            ? formatCsvNumeric(totalNetWeeklyTips, { maxFractionDigits: 2 })
            : formatMoney(totalNetWeeklyTips),
          "",
        ]);
        timelineBody.push([
          "Tardiness Redistribution",
          forCsv
            ? formatCsvNumeric(totalTardinessRedistribution, { maxFractionDigits: 2 })
            : formatMoney(totalTardinessRedistribution),
          "",
        ]);
        timelineBody.push([
          "Final Weekly Tips Payable",
          forCsv
            ? formatCsvNumeric(totalFinalWeeklyTipsPayable, { maxFractionDigits: 2 })
            : formatMoney(totalFinalWeeklyTipsPayable),
          "",
        ]);
        if (kind === "csv") {
          exportTableToCSV(timelineHeaders, timelineBody, `${fileBase}.csv`);
        } else {
          exportTableToPDF("", timelineHeaders, timelineBody, `${fileBase}.pdf`, {
            headFillColor: PDF_HEAD_INDIGO,
            weeklyPayoutHeader: exportMeta.weeklyPayoutHeader,
            bodyFontSize: 8.5,
            headFontSize: 8.5,
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
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.additionalTips ?? 0)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.additionalTips ?? 0))),
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.netWeeklyTips)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.netWeeklyTips))),
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.tardinessRedistribution)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.tardinessRedistribution))),
            forCsv ? formatCsvNumeric(sum(payouts.map((p) => p.finalWeeklyTipsPayable)), { maxFractionDigits: 2 }) : formatMoney(sum(payouts.map((p) => p.finalWeeklyTipsPayable))),
          ]);
        }
        if (kind === "csv") {
          exportTableToCSV(hdr, rows, `${fileBase}.csv`);
        } else if (employeeScope === "one_employee") {
          const employeeLabel =
            weeklyPayoutEmployeeOptions.find((o) => o.value === selectedEmployeeId)?.employeeName ||
            selectedEmployeeFilter.employeeName ||
            selectedEmployeeFilter.employeeId;
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
      weeklyPayoutEmployeeOptions,
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
      if (tardinessGeographicScope === "one_location" && !singleLocationId) {
        toast.error("Select location");
        return;
      }
      if (tardinessEmployeeScope === "one_employee" && !tardinessSelectedEmployee) {
        toast.error("Select employee");
        return;
      }
      const result = await getWeeklyTardiness(
        sd,
        tardinessGeographicScope === "one_location" ? singleLocationId || null : null,
        false,
        sd,
        ed,
      );
      const entries = (result?.entries ?? []).filter((row) => {
        if (
          tardinessEmployeeScope === "one_employee" &&
          String(row?.employeeName || "").trim() !== tardinessSelectedEmployee
        ) {
          return false;
        }
        return true;
      });
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
      const locSlug = tardinessGeographicScope === "one_location" && singleLocationId
        ? sanitizeExportSlug(activeLocations.find((l) => l._id === singleLocationId)?.name)
        : "all-locations";
      const empSlug =
        tardinessEmployeeScope === "one_employee"
          ? sanitizeExportSlug(tardinessSelectedEmployee)
          : "all-employees";
      const file = `weekly-tardiness-${locSlug}-${empSlug}-${sd}-${ed}.${kind}`;
      if (kind === "csv") {
        exportTableToCSV(headers, rows, file);
      } else {
        exportTableToPDF(`Weekly Tardiness ${sd} ${ed}`, headers, rows, file);
      }
    },
    [
      startDate,
      endDate,
      singleLocationId,
      activeLocations,
      tardinessGeographicScope,
      tardinessEmployeeScope,
      tardinessSelectedEmployee,
    ],
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

  const runWeeklyFinalPayableTotalExport = useCallback(
    async (kind) => {
      const sd = toFileDate(startDate);
      const ed = toFileDate(endDate);
      if (!sd || !ed || ed < sd) {
        toast.error("Invalid date range");
        return;
      }
      const summary = await getWeeklyFinalPayableSummary(sd, ed);
      const rowsByEmployee = Array.isArray(summary?.byEmployee)
        ? summary.byEmployee
        : [];
      if (!rowsByEmployee.length) {
        toast.error("No data for export");
        return;
      }

      const locations = Array.isArray(summary?.locations) ? summary.locations : [];
      const formatPayCell = (value) =>
        kind === "csv"
          ? formatCsvNumeric(value, { maxFractionDigits: 2 })
          : formatMoney(value);

      const headers = [
        "Employee",
        "Working hours",
        ...locations.map((loc) => String(loc.locationName ?? "").trim() || "—"),
        "Final Weekly Tip Payable",
      ];
      const rows = rowsByEmployee.map((row) => {
        const byLoc = row.byLocation ?? {};
        const locCells = locations.map((loc) => {
          const lid = String(loc.locationId ?? "");
          const amt = Number(byLoc[lid]?.finalWeeklyTipsPayable) || 0;
          return formatPayCell(amt);
        });
        return [
          row.employeeName ?? "-",
          formatDurationForReport(row.totalWorkingMinutes),
          ...locCells,
          formatPayCell(row.totalFinalWeeklyTipsPayable),
        ];
      });
      const grandByLoc = summary?.grandTotalsByLocation ?? {};
      rows.push([
        "Total",
        formatDurationForReport(summary?.grandTotalWorkingMinutes),
        ...locations.map((loc) => {
          const lid = String(loc.locationId ?? "");
          const amt = Number(grandByLoc[lid]?.finalWeeklyTipsPayable) || 0;
          return formatPayCell(amt);
        }),
        formatPayCell(summary?.grandTotalFinalWeeklyTipsPayable),
      ]);

      const file = `weekly-final-payable-total-all-locations-${sd}-${ed}.${kind}`;
      if (kind === "csv") {
        exportTableToCSV(headers, rows, file);
      } else {
        exportTableToPDF(
          `Weekly Final Payable Total (All Locations) ${sd} ${ed}`,
          headers,
          rows,
          file,
          { headFillColor: PDF_HEAD_INDIGO },
        );
      }
    },
    [startDate, endDate],
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

  const runTipHistoryExport = useCallback(
    async (kind) => {
      const sd = toFileDate(startDate);
      const ed = toFileDate(endDate);
      if (!sd || !ed || ed < sd) {
        toast.error("Invalid date range");
        return;
      }

      const all = await getDailyTipsHistory(1, 10000);
      const source = Array.isArray(all?.items) ? all.items : [];
      const rowsFiltered = source.filter((row) => {
        const d = toFileDate(row?.date);
        if (!d || d < sd || d > ed) return false;
        const lid =
          typeof row?.locationId === "object"
            ? String(row.locationId?._id || "")
            : String(row?.locationId || "");
        return lid === String(singleLocationId);
      });

      if (!rowsFiltered.length) {
        toast.error("No tip history rows for selected filters");
        return;
      }

      const headers = ["User", "Role", "AM Tips", "PM Tips", "Total", "Date", "Location"];
      const rowValues = rowsFiltered.map((row) => {
        const totalTips = (Number(row.amGrossTips) || 0) + (Number(row.pmGrossTips) || 0);
        const userDisplay = row.createdByUsername
          ? `${row.createdByUsername} (${row.createdByEmail || ""})`
          : row.createdByEmail || "";
        const locationName =
          row.locationId?.name ??
          (row.locationId && typeof row.locationId === "object" ? "" : row.locationId ?? "");
        const moneyCell = (n) =>
          kind === "csv" ? formatCsvNumeric(n, { maxFractionDigits: 2 }) : formatMoney(n);
        return [
          userDisplay,
          row.createdByRole || "",
          moneyCell(row.amGrossTips),
          moneyCell(row.pmGrossTips),
          moneyCell(totalTips),
          toFileDate(row.date),
          locationName,
        ];
      });

      const totals = {
        am: sum(rowsFiltered.map((r) => Number(r.amGrossTips) || 0)),
        pm: sum(rowsFiltered.map((r) => Number(r.pmGrossTips) || 0)),
      };
      rowValues.push([
        "Total",
        "",
        kind === "csv" ? formatCsvNumeric(totals.am, { maxFractionDigits: 2 }) : formatMoney(totals.am),
        kind === "csv" ? formatCsvNumeric(totals.pm, { maxFractionDigits: 2 }) : formatMoney(totals.pm),
        kind === "csv"
          ? formatCsvNumeric(totals.am + totals.pm, { maxFractionDigits: 2 })
          : formatMoney(totals.am + totals.pm),
        "",
        "",
      ]);

      const locSlug = singleLocationId
        ? sanitizeExportSlug(activeLocations.find((l) => l._id === singleLocationId)?.name)
        : "all-locations";
      const file = `tip-history-${locSlug}-${sd}-${ed}.${kind}`;
      if (kind === "csv") {
        exportTableToCSV(headers, rowValues, file);
      } else {
        exportTableToPDF("Tip History", headers, rowValues, file);
      }
    },
    [startDate, endDate, singleLocationId, activeLocations],
  );

  const runExport = useCallback(
    async (kind) => {
      if (exportLoadingKind) return;
      setExportLoadingKind(kind);
      try {
        if (reportType === "weekly_payout") await runWeeklyPayoutExport(kind);
        if (reportType === "weekly_tardiness") await runWeeklyTardinessExport(kind);
        if (reportType === "weekly_final_payable_total")
          await runWeeklyFinalPayableTotalExport(kind);
        if (reportType === "daily_tips") await runDailyTipsExport(kind);
        if (reportType === "tip_history") await runTipHistoryExport(kind);
        if (reportType === "production_pool") await runProductionPoolExport(kind);
      } catch (err) {
        toast.error(err?.response?.data?.error || err?.message || "Export failed");
      } finally {
        setExportLoadingKind(null);
      }
    },
    [
      reportType,
      runWeeklyPayoutExport,
      runWeeklyTardinessExport,
      runWeeklyFinalPayableTotalExport,
      runDailyTipsExport,
      runTipHistoryExport,
      runProductionPoolExport,
      exportLoadingKind,
    ],
  );

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-100 via-white to-slate-50 p-4 shadow-2xl sm:p-6 dark:border-white/10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="pointer-events-none absolute -top-20 -right-10 h-56 w-56 rounded-full bg-indigo-500/15 blur-3xl dark:bg-indigo-500/25" />
      <div className="pointer-events-none absolute -bottom-24 -left-10 h-64 w-64 rounded-full bg-fuchsia-500/15 blur-3xl" />

      <div className="relative space-y-5 pb-2">
        <div className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-lg backdrop-blur dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700 dark:text-indigo-300">
                Corvia Analytics
              </p>
              <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                Reports Studio
              </h1>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full bg-gradient-to-r px-4 py-2 text-xs font-semibold text-white shadow ${REPORT_TYPE_STYLES[reportType].accent}`}>
              {(() => {
                const Icon = REPORT_TYPE_STYLES[reportType].icon;
                return <Icon className="h-4 w-4" />;
              })()}
              {REPORT_TYPES.find((x) => x.id === reportType)?.label}
            </div>
          </div>
        </div>

        <Card className="rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-xl backdrop-blur dark:border-white/10 dark:bg-white/5">
          <div className="grid gap-4 xl:grid-cols-12">
            <div className="xl:col-span-4">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
                Report Type
              </label>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {REPORT_TYPES.map((t) => {
                  const active = reportType === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setReportType(t.id)}
                      className={`group flex items-center justify-between rounded-xl border px-3 py-2 text-left transition ${
                        active
                          ? `bg-indigo-50 shadow ring-2 ${REPORT_TYPE_STYLES[t.id].ring} border-transparent dark:bg-white/10`
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-white/15 dark:bg-white/5 dark:hover:border-white/30 dark:hover:bg-white/10"
                      }`}
                    >
                      <span className={`text-sm font-semibold ${active ? "text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-200"}`}>
                        {t.label}
                      </span>
                      <FiChevronRight className={`h-4 w-4 transition ${active ? "text-indigo-600 dark:text-indigo-300" : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200"}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="xl:col-span-8 xl:border-l xl:border-slate-200 xl:pl-5 dark:xl:border-white/15">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {reportType === "daily_tips" ? (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                      <FiCalendar className="h-3.5 w-3.5" /> Date
                    </label>
                    <input
                      type="date"
                      value={singleDate}
                      onChange={(e) => setSingleDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:ring-indigo-300/30 dark:[&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:opacity-75 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                    />
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                        <FiCalendar className="h-3.5 w-3.5" /> From
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:ring-indigo-300/30 dark:[&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:opacity-75 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                        <FiCalendar className="h-3.5 w-3.5" /> To
                      </label>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:[color-scheme:dark] dark:focus:ring-indigo-300/30 dark:[&::-webkit-calendar-picker-indicator]:invert dark:[&::-webkit-calendar-picker-indicator]:opacity-75 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                      />
                    </div>
                  </>
                )}

                {(reportType === "daily_tips" || reportType === "tip_history") && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                      <FiMapPin className="h-3.5 w-3.5" /> Location
                    </label>
                    <select
                      value={singleLocationId}
                      onChange={(e) => setSingleLocationId(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                    >
                      {activeLocations.map((loc) => (
                        <option key={loc._id} value={loc._id}>
                          {loc.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {reportType === "weekly_payout" && (
                <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                      Location Scope
                    </label>
                    <select
                      value={geographicScope}
                      onChange={(e) => setGeographicScope(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                    >
                      <option value="one_location">One location</option>
                      <option value="all_locations">All locations</option>
                    </select>
                  </div>

                  {geographicScope === "one_location" && (
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                        Location
                      </label>
                      <select
                        value={singleLocationId}
                        onChange={(e) => setSingleLocationId(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                      >
                        {activeLocations.map((loc) => (
                          <option key={loc._id} value={loc._id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                      Employee Scope
                    </label>
                    <select
                      value={employeeScope}
                      onChange={(e) => {
                        setEmployeeScope(e.target.value);
                        setSelectedEmployeeId("");
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                    >
                      <option value="all">All employees</option>
                      <option value="one_employee">One employee</option>
                    </select>
                  </div>

                  {employeeScope === "one_employee" && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                        <FiUser className="h-3.5 w-3.5" /> Employee
                      </label>
                      <select
                        value={selectedEmployeeId}
                        onChange={(e) => setSelectedEmployeeId(e.target.value)}
                        disabled={loadingEmployees}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                      >
                        <option value="">
                          {loadingEmployees ? "Loading employees…" : "Select employee…"}
                        </option>
                        {weeklyPayoutEmployeeOptions.map((e) => (
                          <option key={e.value} value={e.value}>
                            {e.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {reportType === "weekly_tardiness" && (
                <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                      Location Scope
                    </label>
                    <select
                      value={tardinessGeographicScope}
                      onChange={(e) => setTardinessGeographicScope(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                    >
                      <option value="one_location">One location</option>
                      <option value="all_locations">All locations</option>
                    </select>
                  </div>

                  {tardinessGeographicScope === "one_location" && (
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                        Location
                      </label>
                      <select
                        value={singleLocationId}
                        onChange={(e) => setSingleLocationId(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                      >
                        {activeLocations.map((loc) => (
                          <option key={loc._id} value={loc._id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                      Employee Scope
                    </label>
                    <select
                      value={tardinessEmployeeScope}
                      onChange={(e) => {
                        setTardinessEmployeeScope(e.target.value);
                        setTardinessSelectedEmployee("");
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                    >
                      <option value="all">All employees</option>
                      <option value="one_employee">One employee</option>
                    </select>
                  </div>

                  {tardinessEmployeeScope === "one_employee" && (
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                        <FiUser className="h-3.5 w-3.5" /> Employee
                      </label>
                      <select
                        value={tardinessSelectedEmployee}
                        onChange={(e) => setTardinessSelectedEmployee(e.target.value)}
                        disabled={loadingTardinessEmployees}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60 dark:border-white/15 dark:bg-slate-900/80 dark:text-slate-100 dark:focus:ring-indigo-300/30"
                      >
                        <option value="">
                          {loadingTardinessEmployees
                            ? "Loading employees…"
                            : "Select employee…"}
                        </option>
                        {tardinessEmployeeOptions.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            disabled={!!exportLoadingKind}
            onClick={() => runExport("csv")}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-200 text-slate-800 shadow-lg ring-1 ring-slate-300 transition hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-100 dark:ring-white/15 dark:hover:bg-slate-700"
          >
            <FiFileText className="h-4 w-4" />
            {exportLoadingKind === "csv" ? "Exporting…" : "Export CSV"}
          </Button>
          <Button
            type="button"
            disabled={!!exportLoadingKind}
            onClick={() => runExport("pdf")}
            className={`inline-flex items-center gap-2 rounded-xl bg-gradient-to-r px-4 text-white shadow-lg transition hover:opacity-95 ${REPORT_TYPE_STYLES[reportType].accent}`}
          >
            <FiDownload className="h-4 w-4" />
            {exportLoadingKind === "pdf" ? "Exporting…" : "Export PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}
