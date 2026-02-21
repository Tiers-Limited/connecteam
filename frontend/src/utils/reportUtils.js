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
export function exportTableToPDF(title, headers, rows, filename) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.text(title, 14, 12);
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 18,
    styles: { fontSize: 7 },
    headStyles: { fillColor: [71, 85, 105] },
    margin: { left: 14, right: 14 },
  });
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
export function exportMultiTableToPDF(title, tables, filename) {
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
      headStyles: { fillColor: [71, 85, 105] },
      margin: { left: 14, right: 14 },
    });
    startY = doc.lastAutoTable.finalY + 12;
  });
  doc.save(filename || 'report.pdf');
}
