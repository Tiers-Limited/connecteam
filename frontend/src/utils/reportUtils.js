import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/** Excel on Windows expects a BOM to interpret UTF-8; avoids mojibake (e.g. â€"). */
const CSV_UTF8_BOM = '\uFEFF';

function withCsvUtf8Bom(text) {
  return CSV_UTF8_BOM + text;
}

/**
 * Escape a CSV cell (wrap in quotes if contains comma, newline, or quote).
 */
function escapeCsvCell(value) {
  const s = value == null ? '' : String(value).trim();
  if (/[,"\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const INDIGO_RGB = [79, 70, 229];
/** Matches single-employee weekly payout PDF branding. */
export const REPORT_BRAND_NAME = 'Corvia Tips Dashboard';

/**
 * Landscape weekly payout: indigo band, brand, report name, pay period + scope on the right.
 * @param {import('jspdf').default} doc
 * @param {{ periodStart: string, periodEnd: string, scopeLabel: string }} meta
 * @returns {number} Y (mm) to start the first table below the band
 */
function drawWeeklyPayoutLandscapeHeader(doc, meta) {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const periodStart = String(meta.periodStart || '').trim();
  const periodEnd = String(meta.periodEnd || '').trim();
  const scope = String(meta.scopeLabel ?? '').trim() || '-';
  const period = `Pay period: ${periodStart} - ${periodEnd}`;
  const scopeLine = `Scope: ${scope}`;
  const rightBlock = doc.splitTextToSize(`${period}\n${scopeLine}`, pageW / 2 - margin);
  const bandH = Math.max(24, Math.min(8 + rightBlock.length * 3.6 + 10, 38));

  doc.setFillColor(INDIGO_RGB[0], INDIGO_RGB[1], INDIGO_RGB[2]);
  doc.rect(0, 0, pageW, bandH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(REPORT_BRAND_NAME, margin, 9);
  doc.setFontSize(15);
  doc.text('Weekly payout report', margin, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let ry = 8;
  rightBlock.forEach((line) => {
    doc.text(line, pageW - margin, ry, { align: 'right' });
    ry += 3.6;
  });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  return bandH + 6;
}

/**
 * PDF header meta + CSV preamble lines (ASCII hyphens so Excel shows dates correctly).
 * @param {string} periodStart YYYY-MM-DD
 * @param {string} periodEnd YYYY-MM-DD
 * @param {string} scopeLabel e.g. "All locations"
 */
export function buildWeeklyPayoutExportMeta(periodStart, periodEnd, scopeLabel) {
  const scope = String(scopeLabel ?? '').trim() || '-';
  return {
    weeklyPayoutHeader: {
      periodStart: String(periodStart || '').trim(),
      periodEnd: String(periodEnd || '').trim(),
      scopeLabel: scope,
    },
    csvMetaLines: [
      'Weekly payout report',
      REPORT_BRAND_NAME,
      `Pay period: ${String(periodStart || '').trim()} - ${String(periodEnd || '').trim()}`,
      `Scope: ${scope}`,
    ],
  };
}

/**
 * Download table data as CSV.
 * @param {string[]} headers - Column headers
 * @param {string[][]} rows - Array of rows, each row an array of cell values (same length as headers)
 * @param {string} filename - e.g. 'daily-tips-2025-02-21.csv'
 */
export function exportTableToCSV(headers, rows, filename) {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  const csv = withCsvUtf8Bom([headerLine, ...dataLines].join('\r\n'));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download table data as PDF using jsPDF and autoTable.
 * @param {string} title - Report title (shown at top)
 * @param {string[]} headers - Column headers
 * @param {string[][]} rows - Array of rows for the table body
 * @param {string} filename - e.g. 'daily-tips-2025-02-21.pdf'
 */
/**
 * @param {{ headFillColor?: [number, number, number], weeklyPayoutHeader?: { periodStart: string, periodEnd: string, scopeLabel: string } }} [options] - When `weeklyPayoutHeader` is set, draws branded band and ignores plain `title` for the header area.
 */
export function exportTableToPDF(title, headers, rows, filename, options = {}) {
  const headFillColor = options.headFillColor || [71, 85, 105];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const meta = options.weeklyPayoutHeader;
  const startY =
    meta && meta.periodStart && meta.periodEnd && meta.scopeLabel != null
      ? drawWeeklyPayoutLandscapeHeader(doc, meta)
      : (() => {
          doc.setFontSize(14);
          doc.text(title, 14, 12);
          return 18;
        })();
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY,
    styles: { fontSize: 7 },
    headStyles: { fillColor: headFillColor },
    margin: { left: 14, right: 14 },
  });
  doc.save(filename || 'report.pdf');
}

const SLATE_800 = [30, 41, 59];
const SLATE_500 = [100, 116, 139];
const SLATE_200 = [226, 232, 240];
const SLATE_50 = [248, 250, 252];

/** Build 2-column body: one Item / Detail pair per row. */
function buildEmployeeReportDetailBody(headers, rowVals) {
  return headers.map((label, j) => [
    String(label),
    String(rowVals[j] ?? ''),
  ]);
}

/**
 * Portrait PDF for “one employee” exports: branded header, employee title,
 * data as one Item column and one Detail column, footer.
 * @param {object} p
 * @param {string[]} p.headers
 * @param {string[][]} p.rows
 * @param {string} p.filename
 * @param {string} p.searchQuery
 * @param {string} p.periodLabel
 * @param {string} p.scopeLabel
 * @param {object[]} [p.payouts]
 */
export function exportSingleEmployeeWeeklyPayoutPDF(p) {
  const {
    headers,
    rows,
    filename,
    searchQuery,
    periodLabel,
    scopeLabel,
    payouts = [],
  } = p;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const tableW = pageW - margin * 2;
  const colItem = tableW * 0.3;
  const colDetail = tableW - colItem;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const rightW = pageW / 2 - margin;
  const rightBlock = doc.splitTextToSize(
    `${String(periodLabel || '')}\n${String(scopeLabel || '')}`,
    rightW,
  );
  const bandH = Math.max(28, Math.min(9 + rightBlock.length * 3.6 + 7, 40));

  doc.setFillColor(INDIGO_RGB[0], INDIGO_RGB[1], INDIGO_RGB[2]);
  doc.rect(0, 0, pageW, bandH, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(REPORT_BRAND_NAME, margin, 10);
  doc.setFontSize(14);
  doc.text('Weekly payout - employee report', margin, 19);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let ry = 7;
  rightBlock.forEach((line) => {
    doc.text(line, pageW - margin, ry, { align: 'right' });
    ry += 3.6;
  });

  const contentW = pageW - margin * 2;
  let y = bandH + 8;
  doc.setTextColor(SLATE_800[0], SLATE_800[1], SLATE_800[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  const sameName =
    payouts.length > 0 &&
    payouts.every(
      (x) =>
        String(x.employeeName || '').trim() ===
        String(payouts[0].employeeName || '').trim(),
    );
  const primaryName =
    payouts.length === 1 || sameName
      ? String(
          payouts[0]?.employeeName || searchQuery || 'Employee',
        ).trim()
      : `Search: “${String(searchQuery || '').trim()}”`;
  const nameLines = doc.splitTextToSize(primaryName, contentW);
  nameLines.forEach((line) => {
    doc.text(line, margin, y);
    y += 6.5;
  });
  y += 6;

  const footLeft = `Generated ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · Confidential`;

  const drawDetailTable = (startY, body) => {
    autoTable(doc, {
      head: [['Item', 'Detail']],
      body,
      startY,
      tableWidth: tableW,
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
        lineColor: [SLATE_200[0], SLATE_200[1], SLATE_200[2]],
        lineWidth: 0.12,
        textColor: [SLATE_800[0], SLATE_800[1], SLATE_800[2]],
        valign: 'top',
      },
      headStyles: {
        fillColor: INDIGO_RGB,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'left',
        fontSize: 8.5,
      },
      columnStyles: {
        0: {
          fontStyle: 'bold',
          cellWidth: colItem,
          fillColor: [SLATE_50[0], SLATE_50[1], SLATE_50[2]],
        },
        1: { cellWidth: colDetail, halign: 'left' },
      },
      margin: { left: margin, right: margin },
      didDrawPage: (data) => {
        doc.setFontSize(7.5);
        doc.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
        doc.setFont('helvetica', 'normal');
        doc.text(footLeft, margin, pageH - 5);
        doc.text(`Page ${data.pageNumber}`, pageW - margin, pageH - 5, {
          align: 'right',
        });
      },
    });
  };

  if (!rows.length) {
    doc.save(filename || 'report.pdf');
    return;
  }

  if (rows.length === 1) {
    const body = buildEmployeeReportDetailBody(headers, rows[0]);
    drawDetailTable(y, body);
  } else {
    let cursorY = y;
    rows.forEach((rowVals, idx) => {
      const loc =
        payouts[idx]?.locationName ||
        rowVals[1] ||
        `Record ${idx + 1}`;
      if (idx > 0) {
        cursorY = (doc.lastAutoTable?.finalY ?? cursorY) + 10;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(INDIGO_RGB[0], INDIGO_RGB[1], INDIGO_RGB[2]);
      doc.text(String(loc), margin, cursorY);
      cursorY += 5;
      doc.setTextColor(SLATE_800[0], SLATE_800[1], SLATE_800[2]);
      const body = buildEmployeeReportDetailBody(headers, rowVals);
      drawDetailTable(cursorY, body);
    });
  }

  doc.save(filename || 'report.pdf');
}

/**
 * Download multiple tables as one CSV (tables separated by a blank line).
 * @param {{ headers: string[], rows: string[][] }[]} tables - Array of { headers, rows }
 * @param {string} filename
 */
export function exportMultiTableToCSV(tables, filename) {
  const parts = tables.map(({ headers, rows }) => {
    const headerLine = headers.map(escapeCsvCell).join(',');
    const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','));
    return [headerLine, ...dataLines].join('\r\n');
  });
  const csv = withCsvUtf8Bom(parts.join('\r\n\r\n'));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Download multiple tables as one PDF (each table after the previous).
 * @param {string} title - Report title
 * @param {{ headers: string[], rows: string[][] }[]} tables - Array of { headers, rows }
 * @param {string} filename
 */
export function exportMultiTableToPDF(title, tables, filename, options = {}) {
  const headFillColor = options.headFillColor || [71, 85, 105];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 14, 12);
  let startY = 18;
  tables.forEach(({ headers, rows }) => {
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY,
      styles: { fontSize: 7 },
      headStyles: { fillColor: headFillColor },
      margin: { left: 14, right: 14 },
    });
    startY = doc.lastAutoTable.finalY + 12;
  });
  doc.save(filename || 'report.pdf');
}

/**
 * Group weekly payout rows by location. Order matches `activeLocations` (app dropdown order);
 * any location not in that list is sorted by name after known sites.
 * Within a location, employees are sorted by name.
 * @param {object[]} payouts
 * @param {{ _id: string, name?: string }[]} activeLocations
 * @returns {{ label: string, payouts: object[] }[]}
 */
export function groupPayoutsByLocationDisplayOrder(payouts, activeLocations) {
  const idOrder = new Map(
    (activeLocations || []).map((l, i) => [String(l._id), i]),
  );

  function resolveOrderAndLabel(p) {
    const lid = p.locationId != null ? String(p.locationId) : '';
    const name = String(p.locationName || '').trim();
    const nameKey = name.toLowerCase();
    let order = Number.MAX_SAFE_INTEGER;
    if (lid && idOrder.has(lid)) {
      order = idOrder.get(lid);
    } else {
      const loc = (activeLocations || []).find(
        (l) => String(l.name || '').trim().toLowerCase() === nameKey,
      );
      if (loc) order = idOrder.get(String(loc._id)) ?? Number.MAX_SAFE_INTEGER;
    }
    const key = lid || `__name__:${nameKey}`;
    const label = name || '—';
    return { key, order, label };
  }

  const map = new Map();
  for (const p of payouts) {
    const { key, order, label } = resolveOrderAndLabel(p);
    if (!map.has(key)) {
      map.set(key, { label, order, payouts: [] });
    }
    map.get(key).payouts.push(p);
  }

  const groups = [...map.values()].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });

  for (const g of groups) {
    g.payouts.sort((a, b) =>
      (a.employeeName || '').localeCompare(b.employeeName || '', undefined, {
        sensitivity: 'base',
      }),
    );
  }
  return groups;
}

/**
 * CSV: optional preamble lines (one cell per row), then each section: location title, header row, data.
 * @param {string | string[]} [reportHeading] - Single line or multiple meta lines (use ASCII for Excel)
 * @param {{ sectionTitle: string, headers: string[], rows: string[][] }[]} sections
 * @param {string} filename
 */
export function exportSectionedTableToCSV(reportHeading, sections, filename) {
  const blocks = sections.map(({ sectionTitle, headers, rows }) => {
    const lines = [];
    if (sectionTitle) {
      lines.push(escapeCsvCell(sectionTitle));
    }
    lines.push(headers.map(escapeCsvCell).join(','));
    lines.push(...rows.map((row) => row.map(escapeCsvCell).join(',')));
    return lines.join('\r\n');
  });
  const preambleLines = Array.isArray(reportHeading)
    ? reportHeading.map((l) => String(l).trim()).filter(Boolean)
    : reportHeading && String(reportHeading).trim()
      ? [String(reportHeading).trim()]
      : [];
  const head =
    preambleLines.length > 0
      ? preambleLines.map((line) => escapeCsvCell(line)).join('\r\n') + '\r\n\r\n'
      : '';
  const csv = withCsvUtf8Bom(head + blocks.join('\r\n\r\n'));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'report.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * PDF: branded header (optional) or plain title, then each section with location heading + table.
 * @param {string} reportTitle - Used only if options.weeklyPayoutHeader is not set
 * @param {{ sectionTitle: string, headers: string[], rows: string[][] }[]} sections
 * @param {string} filename
 */
export function exportSectionedTableToPDF(reportTitle, sections, filename, options = {}) {
  const headFillColor = options.headFillColor || [71, 85, 105];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageH = doc.internal.pageSize.getHeight();
  const meta = options.weeklyPayoutHeader;
  let startY;
  if (meta && meta.periodStart && meta.periodEnd && meta.scopeLabel != null) {
    startY = drawWeeklyPayoutLandscapeHeader(doc, meta);
  } else {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(reportTitle, 14, 12);
    startY = 18;
    doc.setFont('helvetica', 'normal');
  }

  sections.forEach(({ sectionTitle, headers, rows }) => {
    if (!rows || rows.length === 0) return;
    if (sectionTitle) {
      if (startY > pageH - 28) {
        doc.addPage();
        startY = 14;
      }
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 41, 59);
      doc.text(String(sectionTitle), 14, startY);
      startY += 5;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(0, 0, 0);
    }
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY,
      styles: { fontSize: 7 },
      headStyles: { fillColor: headFillColor },
      margin: { left: 14, right: 14 },
    });
    startY = doc.lastAutoTable.finalY + 10;
  });
  doc.save(filename || 'report.pdf');
}
