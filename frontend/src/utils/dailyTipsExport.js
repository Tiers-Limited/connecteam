import { getDailyTipCalculation } from "../services/dailyTipService";
import {
  exportSectionedTableToCSV,
  exportSectionedTableToPDF,
} from "./reportUtils";

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
  return `$${fullNumExport(value)}`;
}

function displayedAmTips(allocation) {
  return (Number(allocation?.amTips) || 0) + (Number(allocation?.manualAmTips) || 0);
}

function displayedPmTips(allocation) {
  return (Number(allocation?.pmTips) || 0) + (Number(allocation?.manualPmTips) || 0);
}

function jobTipMultiplierDisplay(row) {
  const o = row?.tipMultiplierOverride;
  const on = o != null ? Number(o) : NaN;
  if (Number.isFinite(on) && on > 0) return on;
  const m = Number(row?.jobTipMultiplier);
  return Number.isFinite(m) && m > 0 ? m : 1;
}

function amWeightedWorkedHours(row) {
  return (Number(row?.amWorkedHours) || 0) * jobTipMultiplierDisplay(row);
}

function pmWeightedWorkedHours(row) {
  return (Number(row?.pmWorkedHours) || 0) * jobTipMultiplierDisplay(row);
}

function netTipsAfterDeductions(allocation) {
  const fin = Number(allocation?.finalTips ?? allocation?.totalTips) || 0;
  const share = Number(allocation?.redistributionShare) || 0;
  return Math.max(0, fin - share);
}

function toFileDate(d) {
  return String(d || "").trim().slice(0, 10);
}

/**
 * Export daily tips breakdown as CSV or PDF (same layout as Reports Studio).
 * @param {object} options
 * @param {'csv'|'pdf'} options.kind
 * @param {string} options.locationId
 * @param {string} options.date
 * @param {Array<{ _id: string, name?: string }>} options.reportLocations
 * @returns {Promise<void>}
 * @throws {Error} when validation fails or no data
 */
export async function exportDailyTipsReport({
  kind,
  locationId,
  date,
  reportLocations,
}) {
  const d = toFileDate(date);
  if (!d || !locationId) {
    throw new Error("Select location and date");
  }

  const calc = await getDailyTipCalculation(locationId, d, { refresh: false });
  const allocations = (calc?.employeeAllocations ?? [])
    .slice()
    .sort((a, b) =>
      (a.employeeName || "").localeCompare(b.employeeName || "", undefined, {
        sensitivity: "base",
      }),
    );
  const excludedEmployees = Array.isArray(calc?.excludedEmployees)
    ? calc.excludedEmployees
        .slice()
        .sort((a, b) =>
          (a.employeeName || "").localeCompare(b.employeeName || "", undefined, {
            sensitivity: "base",
          }),
        )
    : [];
  if (!allocations.length && excludedEmployees.length === 0) {
    throw new Error("No daily tips rows for export");
  }

  const locName =
    reportLocations.find((l) => l._id === locationId)?.name || "location";
  const isCove = String(locName || "").trim().toLowerCase() === "the cove";
  const moneyCell = (value) =>
    kind === "csv" ? fullNumExport(value) : fullMoneyExport(value);

  const headers = isCove
    ? ["Employee", "Multiplier", "Worked hrs (weighted)", "Tips", "Net tips", "MR", "Total"]
    : [
        "Employee",
        "Multiplier",
        "AM weighted hrs",
        "PM weighted hrs",
        "AM tips",
        "PM tips",
        "Net tips",
        "MR",
        "Total",
      ];

  const rows = allocations.map((a) => {
    if (isCove) {
      return [
        a.employeeName ?? "",
        fullNumExport(jobTipMultiplierDisplay(a)),
        fullNumExport(amWeightedWorkedHours(a) + pmWeightedWorkedHours(a)),
        moneyCell(displayedAmTips(a) + displayedPmTips(a)),
        moneyCell(netTipsAfterDeductions(a)),
        moneyCell(Number(a.redistributionShare ?? 0)),
        moneyCell(Number(a.finalTips ?? a.totalTips ?? 0)),
      ];
    }
    return [
      a.employeeName ?? "",
      fullNumExport(jobTipMultiplierDisplay(a)),
      fullNumExport(amWeightedWorkedHours(a)),
      fullNumExport(pmWeightedWorkedHours(a)),
      moneyCell(displayedAmTips(a)),
      moneyCell(displayedPmTips(a)),
      moneyCell(netTipsAfterDeductions(a)),
      moneyCell(Number(a.redistributionShare ?? 0)),
      moneyCell(Number(a.finalTips ?? a.totalTips ?? 0)),
    ];
  });

  const totals = allocations.reduce(
    (acc, a) => ({
      amWeightedWorkedHours: acc.amWeightedWorkedHours + amWeightedWorkedHours(a),
      pmWeightedWorkedHours: acc.pmWeightedWorkedHours + pmWeightedWorkedHours(a),
      amTips: acc.amTips + displayedAmTips(a),
      pmTips: acc.pmTips + displayedPmTips(a),
      netTips: acc.netTips + netTipsAfterDeductions(a),
      redistributionShare: acc.redistributionShare + (Number(a.redistributionShare) || 0),
      totalTips: acc.totalTips + (Number(a.finalTips ?? a.totalTips) || 0),
    }),
    {
      amWeightedWorkedHours: 0,
      pmWeightedWorkedHours: 0,
      amTips: 0,
      pmTips: 0,
      netTips: 0,
      redistributionShare: 0,
      totalTips: 0,
    },
  );

  if (allocations.length > 0) {
    if (isCove) {
      rows.push([
        "Total",
        "",
        fullNumExport(totals.amWeightedWorkedHours + totals.pmWeightedWorkedHours),
        moneyCell(totals.amTips + totals.pmTips),
        moneyCell(totals.netTips),
        moneyCell(totals.redistributionShare),
        moneyCell(totals.totalTips),
      ]);
    } else {
      rows.push([
        "Total",
        "",
        fullNumExport(totals.amWeightedWorkedHours),
        fullNumExport(totals.pmWeightedWorkedHours),
        moneyCell(totals.amTips),
        moneyCell(totals.pmTips),
        moneyCell(totals.netTips),
        moneyCell(totals.redistributionShare),
        moneyCell(totals.totalTips),
      ]);
    }
  }

  const amGross = Number(calc?.inputs?.amGrossTips) || 0;
  const pmGross = Number(calc?.inputs?.pmGrossTips) || 0;
  const productionPool =
    (Number(calc?.inputs?.productionDeductionAM) || 0) +
    (Number(calc?.inputs?.productionDeductionPM) || 0);
  const distAm = Number(calc?.inputs?.distributableAM) || 0;
  const distPm = Number(calc?.inputs?.distributablePM) || 0;
  const amRate = Number(calc?.totals?.amTipRate) || 0;
  const pmRate = Number(calc?.totals?.pmTipRate) || 0;

  const preambleLines = [
    `Location: ${locName}`,
    `Date: ${d}`,
    isCove ? `Gross Tips: ${fullMoneyExport(amGross)}` : `AM Gross Tips: ${fullMoneyExport(amGross)}`,
    ...(isCove ? [] : [`PM Gross Tips: ${fullMoneyExport(pmGross)}`]),
    `Total Gross Tips: ${fullMoneyExport(amGross + pmGross)}`,
    `5.4% Production Pool: ${fullMoneyExport(productionPool)}`,
    isCove ? `Distributable: ${fullMoneyExport(distAm)}` : `AM Distributable: ${fullMoneyExport(distAm)}`,
    ...(isCove ? [] : [`PM Distributable: ${fullMoneyExport(distPm)}`]),
    isCove ? `Tip Rate: ${fullMoneyExport(amRate)}/hr` : `AM Tip Rate: ${fullMoneyExport(amRate)}/hr`,
    ...(isCove ? [] : [`PM Tip Rate: ${fullMoneyExport(pmRate)}/hr`]),
    excludedEmployees.length > 0
      ? `Excluded employees: ${excludedEmployees.length} (see section below)`
      : null,
  ].filter(Boolean);

  const sections = [];
  if (allocations.length > 0) {
    sections.push({
      sectionTitle: "Employee Allocations",
      headers,
      rows,
    });
  }
  if (excludedEmployees.length > 0) {
    const excludedHeaders = isCove
      ? ["Employee", "Job", "Worked hrs", "Reason"]
      : ["Employee", "Job", "AM hrs", "PM hrs", "Reason"];
    const excludedRows = excludedEmployees.map((ex) => {
      const am = Number(ex.amWorkedHours) || 0;
      const pm = Number(ex.pmWorkedHours) || 0;
      if (isCove) {
        return [
          ex.employeeName ?? "",
          ex.jobTitle || "—",
          fullNumExport(am + pm),
          String(ex.reason ?? "").trim() || "—",
        ];
      }
      return [
        ex.employeeName ?? "",
        ex.jobTitle || "—",
        fullNumExport(am),
        fullNumExport(pm),
        String(ex.reason ?? "").trim() || "—",
      ];
    });
    sections.push({
      sectionTitle: "Excluded Employees (not in calculation)",
      headers: excludedHeaders,
      rows: excludedRows,
    });
  }

  const file = `daily-tips-${sanitizeExportSlug(locName)}-${d}.${kind}`;
  if (kind === "csv") {
    exportSectionedTableToCSV(preambleLines, sections, file);
  } else {
    exportSectionedTableToPDF(`Daily Tips - ${locName} - ${d}`, sections, file, {
      preambleLines,
    });
  }
}
