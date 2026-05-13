import { postWeeklyPayoutReport } from "../services/weeklyPayoutService";
import {
  getDateRangeColumns,
  columnsFromDayDateKeys,
} from "./dateUtils";
import {
  exportTableToCSV,
  exportTableToPDF,
  exportSingleEmployeeWeeklyPayoutPDF,
  groupPayoutsByLocationDisplayOrder,
  exportSectionedTableToCSV,
  exportSectionedTableToPDF,
  buildWeeklyPayoutExportMeta,
} from "./reportUtils";

const PDF_HEAD_INDIGO = [79, 70, 229];

function fullNumExport(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  const rounded = Math.round(n * 10000) / 10000;
  const s = rounded.toString();
  if (s.includes("e") || s.includes("E")) {
    return rounded.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }
  return s;
}

function fullMoneyExport(value) {
  return "$" + fullNumExport(value);
}

function moneyExportCell(value, forCsv) {
  return forCsv ? fullNumExport(value) : fullMoneyExport(value);
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
  const fmt = (n) => moneyExportCell(n, forCsv);
  return [
    p.employeeName ?? "",
    locLabel,
    ...cols.map((_, idx) => fmt((p.dailyTipsByDay || [])[idx] ?? 0)),
    fmt(p.weeklyGrossTips ?? p.dailyTipsMonToSun),
    formatDurationForReport(p.totalWorkingMinutes ?? 0),
    formatDurationForReport(breakMinutesFromPayout(p)),
    String(p.weeklyTardinessMinutes ?? 0),
    `${p.tardinessPercent ?? 0}%`,
    fmt(p.tardinessDeduction),
    fmt(p.weeklyAfterTardiness),
    fmt(p.manualDeduction),
    fmt(p.additionalTips ?? 0),
    fmt(p.netWeeklyTips),
    fmt(p.tardinessRedistribution ?? 0),
    fmt(p.finalWeeklyTipsPayable ?? 0),
  ];
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

function toFileDate(d) {
  return String(d || "").trim().slice(0, 10);
}

/**
 * Export weekly payout report as CSV or PDF (same layout as Reports Studio).
 * @param {object} options
 * @param {'csv'|'pdf'} options.kind
 * @param {string} options.startDate
 * @param {string} options.endDate
 * @param {'one_location'|'all_locations'} options.geographicScope
 * @param {string} [options.singleLocationId]
 * @param {'all'|'one_employee'} options.employeeScope
 * @param {string} [options.selectedEmployeeId]
 * @param {Array<{ _id: string, name?: string }>} options.reportLocations
 * @param {Array<{ value: string, employeeName?: string }>} [options.weeklyPayoutEmployeeOptions]
 * @returns {Promise<void>}
 * @throws {Error} when validation fails or no data
 */
export async function exportWeeklyPayoutReport({
  kind,
  startDate,
  endDate,
  geographicScope,
  singleLocationId,
  employeeScope,
  selectedEmployeeId = "",
  reportLocations,
  weeklyPayoutEmployeeOptions = [],
}) {
  const sd = toFileDate(startDate);
  const ed = toFileDate(endDate);
  if (!sd || !ed || ed < sd) {
    throw new Error("Invalid date range");
  }
  if (geographicScope === "one_location" && !singleLocationId) {
    throw new Error("Select location");
  }
  if (employeeScope === "one_employee" && !selectedEmployeeId) {
    throw new Error("Select employee");
  }
  const selectedEmployeeFilter = parseWeeklyPayoutEmployeeSelection(selectedEmployeeId);

  const scopeSummary =
    geographicScope === "all_locations"
      ? "All locations"
      : reportLocations.find((l) => l._id === singleLocationId)?.name || "One location";

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
    throw new Error("No data for export");
  }
  const cols =
    Array.isArray(reportData.dayDateKeys) && reportData.dayDateKeys.length > 0
      ? columnsFromDayDateKeys(reportData.dayDateKeys)
      : getDateRangeColumns(sd, ed);
  const hdr = weeklyReportHeaders(cols);
  const exportMeta = buildWeeklyPayoutExportMeta(sd, ed, scopeSummary);
  const oneLocationLabel =
    geographicScope === "one_location"
      ? reportLocations.find((l) => String(l._id) === String(singleLocationId))?.name ||
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

  const fmtMoney = (v) => moneyExportCell(v, forCsv);

  if (allLocationsAllEmployees) {
    const groups = groupPayoutsByLocationDisplayOrder(payouts, reportLocations);
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
          ...dayTotals.map((v) => fmtMoney(v)),
          fmtMoney(sum(g.payouts.map((p) => p.weeklyGrossTips ?? p.dailyTipsMonToSun))),
          formatDurationForReport(sum(g.payouts.map((p) => p.totalWorkingMinutes))),
          formatDurationForReport(sum(g.payouts.map((p) => breakMinutesFromPayout(p)))),
          String(sum(g.payouts.map((p) => p.weeklyTardinessMinutes))),
          "",
          fmtMoney(sum(g.payouts.map((p) => p.tardinessDeduction))),
          fmtMoney(sum(g.payouts.map((p) => p.weeklyAfterTardiness))),
          fmtMoney(sum(g.payouts.map((p) => p.manualDeduction))),
          fmtMoney(sum(g.payouts.map((p) => p.additionalTips ?? 0))),
          fmtMoney(sum(g.payouts.map((p) => p.netWeeklyTips))),
          fmtMoney(sum(g.payouts.map((p) => p.tardinessRedistribution))),
          fmtMoney(sum(g.payouts.map((p) => p.finalWeeklyTipsPayable))),
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
      fmtMoney(r.amount),
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
    timelineBody.push(["Total", fmtMoney(totalAmount), "All locations"]);
    timelineBody.push(["", "", ""]);
    timelineBody.push(["Weekly Gross Tips", fmtMoney(totalWeeklyGrossTips), ""]);
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
    timelineBody.push(["Tardiness Deduction", fmtMoney(totalTardinessDeduction), ""]);
    timelineBody.push([
      "Weekly After Tardiness",
      fmtMoney(totalWeeklyAfterTardiness),
      "",
    ]);
    timelineBody.push(["Manual Deduction", fmtMoney(totalManualDeduction), ""]);
    timelineBody.push(["Additional Tips (+)", fmtMoney(totalAdditionalTips), ""]);
    timelineBody.push(["Net Weekly Tips", fmtMoney(totalNetWeeklyTips), ""]);
    timelineBody.push([
      "Tardiness Redistribution",
      fmtMoney(totalTardinessRedistribution),
      "",
    ]);
    timelineBody.push([
      "Final Weekly Tips Payable",
      fmtMoney(totalFinalWeeklyTipsPayable),
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
        ...dayTotals.map((v) => fmtMoney(v)),
        fmtMoney(sum(payouts.map((p) => p.weeklyGrossTips ?? p.dailyTipsMonToSun))),
        formatDurationForReport(sum(payouts.map((p) => p.totalWorkingMinutes))),
        formatDurationForReport(sum(payouts.map((p) => breakMinutesFromPayout(p)))),
        String(sum(payouts.map((p) => p.weeklyTardinessMinutes))),
        "",
        fmtMoney(sum(payouts.map((p) => p.tardinessDeduction))),
        fmtMoney(sum(payouts.map((p) => p.weeklyAfterTardiness))),
        fmtMoney(sum(payouts.map((p) => p.manualDeduction))),
        fmtMoney(sum(payouts.map((p) => p.additionalTips ?? 0))),
        fmtMoney(sum(payouts.map((p) => p.netWeeklyTips))),
        fmtMoney(sum(payouts.map((p) => p.tardinessRedistribution))),
        fmtMoney(sum(payouts.map((p) => p.finalWeeklyTipsPayable))),
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
}
