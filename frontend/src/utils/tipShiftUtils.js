/**
 * AM/PM split for manual tips — mirrors backend/services/tipsCalculationService.splitWorkedHours
 * and backend/utils/constants shift boundaries.
 */

const SHIFT_BOUNDARIES = {
  AM_START: "06:00",
  AM_END: "15:00",
  PM_START: "15:00",
  PM_END: "23:00",
};

const SHIFT_BOUNDARIES_CASA_ORANJESTAD = {
  AM_START: "06:00",
  AM_END: "14:00",
  PM_START: "14:00",
  PM_END: "23:00",
};

const LOCATION_SINGLE_SHIFT_KEY = "the cove";

export function shiftBoundariesForLocationName(locationName) {
  const n = (locationName || "").trim().toLowerCase();
  if (n === "casa del mar" || n === "oranjestad") {
    return SHIFT_BOUNDARIES_CASA_ORANJESTAD;
  }
  return SHIFT_BOUNDARIES;
}

function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const parts = timeStr.trim().split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * @param {string} clockIn
 * @param {string} clockOut
 * @param {{ singleShift?: boolean, shiftBoundaries?: object }} opts
 */
export function splitWorkedHours(clockIn, clockOut, opts = {}) {
  const inMin = timeToMinutes(clockIn);
  const outMinRaw = timeToMinutes(clockOut);
  if (inMin == null || outMinRaw == null) {
    return { amHours: 0, pmHours: 0 };
  }

  let startMin = inMin;
  let endMin = outMinRaw;
  if (endMin <= startMin) {
    if (endMin === startMin) return { amHours: 0, pmHours: 0 };
    endMin += 24 * 60;
  }

  if (opts.singleShift) {
    const totalMinutes = endMin - startMin;
    return {
      amHours: totalMinutes / 60,
      pmHours: 0,
    };
  }

  const bounds = opts.shiftBoundaries || SHIFT_BOUNDARIES;
  const AM_START = timeToMinutes(bounds.AM_START);
  const AM_END = timeToMinutes(bounds.AM_END);
  const PM_END = timeToMinutes(bounds.PM_END);
  if (AM_START == null || AM_END == null || PM_END == null) {
    return { amHours: 0, pmHours: 0 };
  }

  let amMinutes = 0;
  let pmMinutes = 0;

  for (let m = startMin; m < endMin; m++) {
    const minuteOfDay = m % (24 * 60);
    if (minuteOfDay >= AM_START && minuteOfDay < AM_END) amMinutes++;
    else if (minuteOfDay >= AM_END && minuteOfDay < PM_END) pmMinutes++;
  }

  return {
    amHours: amMinutes / 60,
    pmHours: pmMinutes / 60,
  };
}

/**
 * @param {string} clockIn
 * @param {string} clockOut
 * @param {string} [locationName]
 */
export function splitWorkedHoursForLocation(clockIn, clockOut, locationName) {
  const n = (locationName || "").trim().toLowerCase();
  if (n === LOCATION_SINGLE_SHIFT_KEY) {
    return splitWorkedHours(clockIn, clockOut, { singleShift: true });
  }
  return splitWorkedHours(clockIn, clockOut, {
    shiftBoundaries: shiftBoundariesForLocationName(locationName),
  });
}

/** Normalize "HH:MM:SS" or "HH:MM" for display. */
export function formatClockLabel(value) {
  if (value == null || String(value).trim() === "") return "—";
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** For <input type="time" /> value (HH:MM). */
export function toTimeInputValue(value) {
  if (value == null || String(value).trim() === "") return "";
  const s = String(value).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}
