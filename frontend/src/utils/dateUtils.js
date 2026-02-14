export function toDateString(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

export function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

export function getWeekEnd(weekStart) {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatWeekRange(weekStart) {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** Week day labels for table columns: [{ dateKey: 'YYYY-MM-DD', label: '02 Feb' }, ...] (Mon–Sun) */
export function getWeekDateColumns(weekStart) {
  const start = new Date(weekStart);
  const cols = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const day = String(d.getDate()).padStart(2, '0');
    const mon = d.toLocaleDateString('en-GB', { month: 'short' });
    cols.push({ dateKey: toDateString(d), label: `${day} ${mon}` });
  }
  return cols;
}

/** Date columns for an arbitrary range: [{ dateKey: 'YYYY-MM-DD', label: '02 Feb' }, ...] */
export function getDateRangeColumns(startDate, endDate) {
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
  const cols = [];
  const d = new Date(start);
  while (d <= end) {
    const day = String(d.getDate()).padStart(2, '0');
    const mon = d.toLocaleDateString('en-GB', { month: 'short' });
    cols.push({ dateKey: toDateString(d), label: `${day} ${mon}` });
    d.setDate(d.getDate() + 1);
  }
  return cols;
}
