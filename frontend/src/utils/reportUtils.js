import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

/**
 * Download table data as CSV.
 * @param {string[]} headers - Column headers
 * @param {string[][]} rows - Array of rows, each row an array of cell values (same length as headers)
 * @param {string} filename - e.g. 'daily-tips-2025-02-21.csv'
 */
export function exportTableToCSV(headers, rows, filename) {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  const csv = [headerLine, ...dataLines].join('\r\n');
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
 * @param {{ headFillColor?: [number, number, number] }} [options] - RGB table header (default slate; use indigo to match app)
 */
export function exportTableToPDF(title, headers, rows, filename, options = {}) {
  const headFillColor = options.headFillColor || [71, 85, 105];
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 14, 12);
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 18,
    styles: { fontSize: 7 },
    headStyles: { fillColor: headFillColor },
    margin: { left: 14, right: 14 },
  });
  doc.save(filename || 'report.pdf');
}

const INDIGO_RGB = [79, 70, 229];
const SLATE_800 = [30, 41, 59];
const SLATE_500 = [100, 116, 139];
const SLATE_200 = [226, 232, 240];
const SLATE_50 = [248, 250, 252];

/** Build 4-column body: two label/value pairs per row (neat vertical scan). */
function buildTwoColumnDetailBody(headers, rowVals) {
  const pairs = headers.map((label, j) => [
    String(label),
    String(rowVals[j] ?? ''),
  ]);
  const body = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    if (b) body.push([a[0], a[1], b[0], b[1]]);
    else body.push([a[0], a[1], '', '']);
  }
  return body;
}

/**
 * Portrait PDF for “one employee” exports: branded header, employee title,
 * data as two columns of label/value pairs (four table columns), footer.
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
  const colLabel = tableW * 0.26;
  const colVal = tableW * 0.24;

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
  doc.text('Corvia Tips Dashboard', margin, 10);
  doc.setFontSize(14);
  doc.text('Weekly payout — employee report', margin, 19);
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
      head: [['Item', 'Details', 'Item', 'Details']],
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
          cellWidth: colLabel,
          fillColor: [SLATE_50[0], SLATE_50[1], SLATE_50[2]],
        },
        1: { cellWidth: colVal, halign: 'left' },
        2: {
          fontStyle: 'bold',
          cellWidth: colLabel,
          fillColor: [SLATE_50[0], SLATE_50[1], SLATE_50[2]],
        },
        3: { cellWidth: colVal, halign: 'left' },
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
    const body = buildTwoColumnDetailBody(headers, rows[0]);
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
      const body = buildTwoColumnDetailBody(headers, rowVals);
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
  const csv = parts.join('\r\n\r\n');
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
