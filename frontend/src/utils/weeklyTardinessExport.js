import { getWeeklyTardiness } from "../services/weeklyTardinessService";
import { getDateRangeColumns } from "./dateUtils";
import { exportTableToCSV, exportTableToPDF } from "./reportUtils";

function timeToMinutes(str) {
  if (!str || typeof str !== "string") return Infinity;
  const [h, m] = str.trim().split(":").map(Number);
  if (Number.isNaN(h)) return Infinity;
  return (h || 0) * 60 + (Number.isNaN(m) ? 0 : m);
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

function sum(values) {
  return values.reduce((acc, n) => acc + (Number(n) || 0), 0);
}

function toFileDate(d) {
  return String(d || "").trim().slice(0, 10);
}

/**
 * Export weekly tardiness report as CSV or PDF (same layout as Reports Studio).
 * @param {object} options
 * @param {'csv'|'pdf'} options.kind
 * @param {string} options.startDate
 * @param {string} options.endDate
 * @param {'one_location'|'all_locations'} options.geographicScope
 * @param {string} [options.singleLocationId]
 * @param {'all'|'one_employee'} [options.employeeScope]
 * @param {string} [options.selectedEmployeeName]
 * @param {Array<{ _id: string, name?: string }>} options.reportLocations
 * @returns {Promise<void>}
 * @throws {Error} when validation fails or no data
 */
export async function exportWeeklyTardinessReport({
  kind,
  startDate,
  endDate,
  geographicScope,
  singleLocationId,
  employeeScope = "all",
  selectedEmployeeName = "",
  reportLocations,
}) {
  const sd = toFileDate(startDate);
  const ed = toFileDate(endDate);
  if (!sd || !ed || ed < sd) {
    throw new Error("Invalid date range");
  }
  if (geographicScope === "one_location" && !singleLocationId) {
    throw new Error("Select location");
  }
  if (employeeScope === "one_employee" && !selectedEmployeeName) {
    throw new Error("Select employee");
  }

  const result = await getWeeklyTardiness(
    sd,
    geographicScope === "one_location" ? singleLocationId || null : null,
    false,
    sd,
    ed,
  );
  const entries = (result?.entries ?? []).filter((row) => {
    if (
      employeeScope === "one_employee" &&
      String(row?.employeeName || "").trim() !== selectedEmployeeName
    ) {
      return false;
    }
    return true;
  });
  if (!entries.length) {
    throw new Error("No data for export");
  }

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
    if (minutes > 0) {
      return `${loc} ${dayRec?.scheduledTime ?? "–"} -> ${dayRec?.clockIn ?? "–"} ${minutes} min`;
    }
    return `${loc} -`;
  };
  const rows = employeeRows.map((rec) => {
    const rowTotal = dateColumns.reduce((acc, col) => {
      const dayRec = rec.byDate[col.dateKey];
      const s = String(dayRec?.scheduledTime ?? "").trim();
      const c = String(dayRec?.clockIn ?? "").trim();
      const mins = s && s === c ? 0 : Math.max(0, Number(dayRec?.minutesLate) || 0);
      return acc + mins;
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
    formatDurationForReport(
      sum(
        employeeRows.map(
          (rec) => Number(result?.totalWorkingMinutesByEmployee?.[rec.employeeName]) || 0,
        ),
      ),
    ),
    formatDurationForReport(
      sum(
        employeeRows.map(
          (rec) => Number(result?.totalBreakMinutesByEmployee?.[rec.employeeName]) || 0,
        ),
      ),
    ),
  ]);

  const locSlug =
    geographicScope === "one_location" && singleLocationId
      ? sanitizeExportSlug(reportLocations.find((l) => l._id === singleLocationId)?.name)
      : "all-locations";
  const empSlug =
    employeeScope === "one_employee"
      ? sanitizeExportSlug(selectedEmployeeName)
      : "all-employees";
  const file = `weekly-tardiness-${locSlug}-${empSlug}-${sd}-${ed}.${kind}`;
  if (kind === "csv") {
    exportTableToCSV(headers, rows, file);
  } else {
    exportTableToPDF(`Weekly Tardiness ${sd} ${ed}`, headers, rows, file);
  }
}
