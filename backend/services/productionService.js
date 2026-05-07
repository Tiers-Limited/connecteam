const DailyTipInput = require('../models/DailyTipInput');
const Location = require('../models/Location');
const ProductionStaff = require('../models/ProductionStaff');
const ProductionManualDeduction = require('../models/ProductionManualDeduction');
/** DB collection where Weekly Tardiness page saves data (weekStart + locationId → payload.entries) */
const WeeklyTardinessCache = require('../models/WeeklyTardinessCache');
const { PRODUCTION_DEDUCTION_PERCENT } = require('../utils/constants');
const connecteamsService = require('./connecteamsService');
const { timeToMinutes, toDateString, getDatesInRange } = require('../utils/dateUtils');

function productionPoolLog(...args) {
  if (process.env.DEBUG_PRODUCTION_POOL === '1') {
    console.log(...args);
  }
}

function roundMoney(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function hashStringToInt(value) {
  let h = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) - h) + text.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function allocateCentsProportionally(items, poolAmount, weightSelector, keySelector, tieBreakerSeed = '') {
  const candidates = (items || []).filter((item) => item && keySelector(item));
  const result = new Map();
  if (candidates.length === 0) return result;

  // Use 0.001 precision units for fairer splits than cents-only allocation.
  const unitScale = 1000;
  const poolUnits = Math.max(0, Math.round((Number(poolAmount) || 0) * unitScale));
  if (poolUnits === 0) return result;

  const weighted = candidates.map((item) => {
    const key = String(keySelector(item));
    const weight = Math.max(0, Number(weightSelector(item)) || 0);
    return { item, key, weight };
  });
  const totalWeight = weighted.reduce((sum, x) => sum + x.weight, 0);

  if (totalWeight <= 0) {
    const base = Math.floor(poolUnits / weighted.length);
    let remainder = poolUnits - base * weighted.length;
    const ordered = weighted.slice().sort((a, b) => a.key.localeCompare(b.key));
    for (const entry of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      if (remainder > 0) remainder -= 1;
      result.set(entry.key, (base + extra) / unitScale);
    }
    return result;
  }

  const prepared = weighted.map((entry) => {
    const exactUnits = (entry.weight / totalWeight) * poolUnits;
    const floorUnits = Math.floor(exactUnits);
    return {
      ...entry,
      floorCents: floorUnits,
      fraction: exactUnits - floorUnits,
    };
  });

  const floorSum = prepared.reduce((sum, entry) => sum + entry.floorCents, 0);
  let remainder = poolUnits - floorSum;
  const ranking = prepared
    .slice()
    .sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      const aRank = hashStringToInt(`${tieBreakerSeed}|${a.key}`);
      const bRank = hashStringToInt(`${tieBreakerSeed}|${b.key}`);
      if (aRank !== bRank) return aRank - bRank;
      return a.key.localeCompare(b.key);
    });
  for (let i = 0; i < ranking.length && remainder > 0; i += 1) {
    ranking[i].floorCents += 1;
    remainder -= 1;
  }

  for (const entry of prepared) {
    result.set(entry.key, entry.floorCents / unitScale);
  }
  return result;
}

function getTardinessDeductionPercent(minutes) {
  if (minutes <= 5) return 0;
  if (minutes <= 10) return 0.15;
  return 0.2;
}

function normalizeStaffName(name) {
  return String(name || '').trim().toLowerCase();
}

function normalizeNameForMatch(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildStaffNameLookup(staffNames) {
  const exact = new Map();
  const candidates = [];
  for (const staffName of staffNames || []) {
    const canonicalStaffName = String(staffName || '').trim();
    if (!canonicalStaffName) continue;
    const matchKey = normalizeNameForMatch(canonicalStaffName);
    if (!matchKey) continue;
    const tokens = matchKey.split(' ').filter(Boolean);
    exact.set(matchKey, canonicalStaffName);
    candidates.push({
      canonicalStaffName,
      matchKey,
      tokens,
    });
  }
  return { exact, candidates };
}

function resolveStaffName(entryName, lookup) {
  const key = normalizeNameForMatch(entryName);
  if (!key || !lookup) return null;
  if (lookup.exact.has(key)) return lookup.exact.get(key);

  const entryTokens = key.split(' ').filter(Boolean);
  if (entryTokens.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const candidate of lookup.candidates || []) {
    const shared = candidate.tokens.filter((t) => entryTokens.includes(t)).length;
    const minRequired = Math.max(2, Math.min(candidate.tokens.length, entryTokens.length) - 1);
    if (shared < minRequired) continue;
    const score = shared / Math.max(candidate.tokens.length, entryTokens.length);
    if (score > bestScore) {
      best = candidate.canonicalStaffName;
      bestScore = score;
    }
  }
  return best;
}

function deriveMinutesLateFromTimes(scheduledTime, clockIn) {
  const scheduled = String(scheduledTime || '').trim();
  const actualClockIn = String(clockIn || '').trim();
  // Never derive tardiness without a valid scheduled time.
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(scheduled)) return 0;
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(actualClockIn)) return 0;
  const scheduledMins = timeToMinutes(scheduledTime);
  const clockInMins = timeToMinutes(clockIn);
  if (!Number.isFinite(scheduledMins) || !Number.isFinite(clockInMins)) return 0;
  return Math.max(0, clockInMins - scheduledMins);
}

async function getDailyProductionPool(dateStr) {
  const d = typeof dateStr === 'string' ? dateStr.slice(0, 10) : toDateString(dateStr);
  const dateStart = new Date(d + 'T00:00:00.000Z');
  const dateEnd = new Date(d + 'T23:59:59.999Z');
  const inputs = await DailyTipInput.find({
    date: { $gte: dateStart, $lte: dateEnd },
  }).lean();
  let pool = 0;
  for (const row of inputs) {
    pool += (Number(row.amGrossTips) || 0) * PRODUCTION_DEDUCTION_PERCENT;
    pool += (Number(row.pmGrossTips) || 0) * PRODUCTION_DEDUCTION_PERCENT;
  }
  return roundMoney(pool);
}

async function getLocationWiseProductionPool(weekStartStr, options = {}) {
  const useDateRange = options.startDate && options.endDate && typeof options.startDate === 'string' && typeof options.endDate === 'string';
  let dateStarts;
  let weekStartDate;
  let weekEndDate;
  if (useDateRange) {
    dateStarts = getDatesInRange(options.startDate.trim().slice(0, 10), options.endDate.trim().slice(0, 10));
    weekStartDate = new Date(dateStarts[0] + 'T00:00:00.000Z');
    weekEndDate = new Date(dateStarts[dateStarts.length - 1] + 'T23:59:59.999Z');
  } else {
    const d = typeof weekStartStr === 'string' ? weekStartStr.slice(0, 10) : toDateString(weekStartStr);
    const [y, mo, day] = d.split('-').map(Number);
    dateStarts = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0));
      dateStarts.push(date.toISOString().slice(0, 10));
    }
    weekStartDate = new Date(Date.UTC(y, mo - 1, day, 0, 0, 0, 0));
    weekEndDate = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
  }
  const inputs = await DailyTipInput.find({
    date: { $gte: weekStartDate, $lte: weekEndDate },
  }).lean();
  const byLocation = new Map();
  const emptyDaily = Array(dateStarts.length).fill(0);
  for (const row of inputs) {
    const locId = (row.locationId && row.locationId._id ? row.locationId._id : row.locationId)?.toString();
    if (!locId) continue;
    const dateStr = (row.date && row.date.toISOString) ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10);
    const dayPool = roundMoney(
      ((Number(row.amGrossTips) || 0) + (Number(row.pmGrossTips) || 0)) * PRODUCTION_DEDUCTION_PERCENT
    );
    if (!byLocation.has(locId)) {
      byLocation.set(locId, { dailyByDay: [...emptyDaily] });
    }
    const rec = byLocation.get(locId);
    const dayIndex = dateStarts.indexOf(dateStr);
    if (dayIndex >= 0) rec.dailyByDay[dayIndex] += dayPool;
  }
  for (const rec of byLocation.values()) {
    rec.weeklyPool = roundMoney(rec.dailyByDay.reduce((s, v) => s + v, 0));
  }
  const locationIds = [...byLocation.keys()];
  const locations = await Location.find({ _id: { $in: locationIds } }).select('name').lean();
  const nameById = Object.fromEntries(locations.map((l) => [l._id.toString(), l.name || '—']));
  return locationIds.map((locationId) => {
    const rec = byLocation.get(locationId);
    return {
      locationId,
      locationName: nameById[locationId] || '—',
      weeklyPool: rec.weeklyPool,
      dailyByDay: rec.dailyByDay,
    };
  }).sort((a, b) => (a.locationName || '').localeCompare(b.locationName || ''));
}

async function getProductionStaff() {
  return ProductionStaff.find({ isActive: true }).sort({ name: 1 }).lean();
}

async function getProductionTardinessMap(weekStartStr, staffNames, options = {}) {
  const map = new Map(staffNames.map((n) => [n, 0]));
  const staffNameLookup = buildStaffNameLookup(staffNames);
  let entries = [];
  if (options.connecteamPayload && Array.isArray(options.connecteamPayload.entries)) {
    entries = options.connecteamPayload.entries;
  } else {
    const tardinessDocs = await WeeklyTardinessCache.find({ weekStart: weekStartStr }).lean();
    for (const doc of tardinessDocs) {
      if (doc.payload?.entries && Array.isArray(doc.payload.entries)) {
        entries.push(...doc.payload.entries);
      }
    }
  }
  if (entries.length === 0) return map;
  productionPoolLog('[ProductionPoolDebug] tardiness input', {
    weekStart: weekStartStr,
    staffCount: staffNames.length,
    entryCount: entries.length,
    source: options.connecteamPayload ? 'connecteamPayload' : 'weeklyTardinessCache',
  });
  const firstPunchByKey = new Map();
  let skippedMissingCoreFields = 0;
  const tardinessSampleRows = [];
  for (const e of entries) {
    const rawName = (e.employeeName || '').toString().trim();
    const name = resolveStaffName(rawName, staffNameLookup);
    const date = (e.date || '').toString().slice(0, 10);
    if (!name || !date || !e.clockIn) {
      skippedMissingCoreFields += 1;
      continue;
    }
    const key = `${name}|${date}`;
    const clockInMins = timeToMinutes(e.clockIn);
    const payloadMinutesLate = Math.max(0, Number(e.minutesLate) || 0);
    const derivedMinutesLate = deriveMinutesLateFromTimes(e.scheduledTime, e.clockIn);
    const minutesLate = Math.max(payloadMinutesLate, derivedMinutesLate);
    const existing = firstPunchByKey.get(key);
    if (existing == null || clockInMins < existing.clockInMins) {
      firstPunchByKey.set(key, {
        clockInMins,
        minutesLate,
        payloadMinutesLate,
        derivedMinutesLate,
        scheduledTime: e.scheduledTime || null,
        clockIn: e.clockIn || null,
      });
      if (tardinessSampleRows.length < 25) {
        tardinessSampleRows.push({
          name,
          date,
          scheduledTime: e.scheduledTime || null,
          clockIn: e.clockIn || null,
          payloadMinutesLate,
          derivedMinutesLate,
          usedMinutesLate: minutesLate,
        });
      }
    }
  }
  const tardinessDebugRows = [];
  for (const [key, { minutesLate, scheduledTime, clockIn, payloadMinutesLate, derivedMinutesLate }] of firstPunchByKey) {
    const name = key.split('|')[0];
    if (map.has(name)) {
      map.set(name, (map.get(name) || 0) + minutesLate);
      const date = key.split('|')[1];
      tardinessDebugRows.push({
        name,
        date,
        scheduledTime,
        clockIn,
        payloadMinutesLate,
        derivedMinutesLate,
        usedMinutesLate: minutesLate,
      });
    }
  }
  const tardinessTotals = Array.from(map.entries())
    .map(([name, totalMinutes]) => ({ name, totalMinutes }))
    .filter((row) => row.totalMinutes > 0)
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
  productionPoolLog('[ProductionPoolDebug] tardiness parse summary', {
    uniqueEmployeeDays: firstPunchByKey.size,
    skippedMissingCoreFields,
    contributingRows: tardinessDebugRows.length,
    tardinessSampleRows,
    tardinessTotals,
  });
  return map;
}

async function getProductionClockedInDatesMap(weekStartStr, staffNames, options = {}) {
  const canonicalStaffBySimpleKey = new Map(
    staffNames.map((n) => [normalizeStaffName(n), String(n || '').trim()]),
  );
  const map = new Map(staffNames.map((n) => [normalizeStaffName(n), new Set()]));
  const staffNameLookup = buildStaffNameLookup(staffNames);
  let entries = [];
  if (options.connecteamPayload && Array.isArray(options.connecteamPayload.entries)) {
    entries = options.connecteamPayload.entries;
  } else {
    const tardinessDocs = await WeeklyTardinessCache.find({ weekStart: weekStartStr }).lean();
    for (const doc of tardinessDocs) {
      if (doc.payload?.entries && Array.isArray(doc.payload.entries)) {
        entries.push(...doc.payload.entries);
      }
    }
  }
  if (entries.length === 0) return map;
  productionPoolLog('[ProductionPoolDebug] clocked-in input', {
    weekStart: weekStartStr,
    staffCount: staffNames.length,
    entryCount: entries.length,
    source: options.connecteamPayload ? 'connecteamPayload' : 'weeklyTardinessCache',
  });

  // Keep one first-punch per employee/day to represent clock-in presence.
  const firstPunchByKey = new Map();
  let skippedMissingFields = 0;
  let skippedInvalidClockIn = 0;
  const sampleRawClockRows = [];
  for (const e of entries) {
    const canonicalName = resolveStaffName(e.employeeName, staffNameLookup);
    const nameKey = normalizeStaffName(canonicalName);
    const date = (e.date || '').toString().slice(0, 10);
    if (!nameKey || !date || !e.clockIn) {
      skippedMissingFields += 1;
      continue;
    }
    if (!map.has(nameKey)) continue;
    const key = `${nameKey}|${date}`;
    const clockInMins = timeToMinutes(e.clockIn);
    if (!Number.isFinite(clockInMins)) {
      skippedInvalidClockIn += 1;
      continue;
    }
    if (sampleRawClockRows.length < 25) {
      sampleRawClockRows.push({
        employeeName: e.employeeName || '',
        mappedToStaffName: canonicalName || null,
        date,
        clockIn: e.clockIn || null,
        clockOut: e.clockOut || null,
        minutesLate: Number(e.minutesLate) || 0,
      });
    }
    const existing = firstPunchByKey.get(key);
    if (existing == null || clockInMins < existing.clockInMins) {
      firstPunchByKey.set(key, {
        nameKey,
        date,
        clockInMins,
      });
    }
  }

  for (const row of firstPunchByKey.values()) {
    map.get(row.nameKey).add(row.date);
  }
  const clockedInSummary = Array.from(map.entries()).map(([nameKey, datesSet]) => ({
    nameKey,
    staffName: canonicalStaffBySimpleKey.get(nameKey) || nameKey,
    clockedInDates: Array.from(datesSet).sort(),
    daysCount: datesSet.size,
  }));
  productionPoolLog('[ProductionPoolDebug] clocked-in parse summary', {
    uniqueEmployeeDays: firstPunchByKey.size,
    skippedMissingFields,
    skippedInvalidClockIn,
    sampleRawClockRows,
    clockedInSummary,
  });
  return map;
}


async function getWeeklyProductionPayout(weekStartStr, options = {}) {
  const staff = await ProductionStaff.find({ isActive: true }).sort({ name: 1 });
  if (staff.length === 0) {
    return {
      weekStart: weekStartStr,
      weekEnd: '',
      locationWisePool: [],
      redistributionPool: 0,
      payouts: [],
      ...(options.startDate && options.endDate && { dateRange: { startDate: options.startDate.trim().slice(0, 10), endDate: options.endDate.trim().slice(0, 10) } }),
    };
  }
  const useDateRange = options.startDate && options.endDate && typeof options.startDate === 'string' && typeof options.endDate === 'string';
  let dateStrs;
  let weekEndStr;
  let weekStartForManual = weekStartStr;
  if (useDateRange) {
    const start = options.startDate.trim().slice(0, 10);
    const end = options.endDate.trim().slice(0, 10);
    dateStrs = getDatesInRange(start, end);
    weekEndStr = end;
    weekStartForManual = start;
  } else {
    const [y, mo, day] = weekStartStr.split('-').map(Number);
    const weekEnd = new Date(Date.UTC(y, mo - 1, day + 6, 23, 59, 59, 999));
    weekEndStr = weekEnd.toISOString().slice(0, 10);
    dateStrs = [];
    for (let i = 0; i < 7; i++) {
      dateStrs.push(new Date(Date.UTC(y, mo - 1, day + i, 0, 0, 0, 0)).toISOString().slice(0, 10));
    }
  }
  const numDays = dateStrs.length;

  const locationWise = await getLocationWiseProductionPool(weekStartStr, options);
  const dailyPoolByDate = new Map(
    dateStrs.map((d, idx) => [
      d,
      roundMoney(
        locationWise.reduce(
          (sum, row) => sum + (Number((row.dailyByDay || [])[idx]) || 0),
          0,
        ),
      ),
    ]),
  );

  const staffNames = staff.map((s) => s.name.trim());
  const rangeStart = dateStrs[0];
  const rangeEnd = dateStrs[dateStrs.length - 1];
  const connecteamPayload = await connecteamsService.getTardinessFromConnecteamsByDateRange(
    rangeStart,
    rangeEnd,
    null,
    { includeAllLocations: true }
  );
  productionPoolLog('[ProductionPoolDebug] connecteam payload summary', {
    startDate: rangeStart,
    endDate: rangeEnd,
    entries: Array.isArray(connecteamPayload?.entries) ? connecteamPayload.entries.length : 0,
  });
  const tardinessMap = await getProductionTardinessMap(weekStartStr, staffNames, { connecteamPayload });
  const clockedInDatesByStaff = await getProductionClockedInDatesMap(
    weekStartStr,
    staffNames,
    { connecteamPayload },
  );
  const manualDeductions = await ProductionManualDeduction.find({ weekStart: weekStartForManual })
    .populate('productionStaffId')
    .lean();
  const manualMap = new Map();
  manualDeductions.forEach((m) => {
    const id = m.productionStaffId?._id?.toString();
    if (id) manualMap.set(id, { amount: m.amount, reason: m.reason || '' });
  });

  const dailyGrossByStaffId = new Map();
  for (const s of staff) {
    dailyGrossByStaffId.set(s._id.toString(), Array(numDays).fill(0));
  }

  for (let i = 0; i < numDays; i += 1) {
    const dateStr = dateStrs[i];
    const pool = dailyPoolByDate.get(dateStr) || 0;
    const clockedInStaff = staff.filter((member) =>
      clockedInDatesByStaff
        .get(normalizeStaffName(member.name))
        ?.has(dateStr),
    );
    const byStaffId = allocateCentsProportionally(
      clockedInStaff,
      pool,
      (member) => Number(member.allocationPercent) || 0,
      (member) => member?._id?.toString?.() || '',
      dateStr,
    );
    for (const s of staff) {
      const id = s._id.toString();
      const arr = dailyGrossByStaffId.get(id);
      arr[i] = byStaffId.get(id) || 0;
    }
    productionPoolLog('[ProductionPoolDebug] daily distribution', {
      date: dateStr,
      grossProductionPool: pool,
      clockedInStaff: clockedInStaff.map((member) => member.name),
      distributedByStaff: staff.map((member) => ({
        name: member.name,
        amount: byStaffId.get(member._id.toString()) || 0,
      })),
    });
  }

  const rows = [];
  for (const s of staff) {
    const id = s._id.toString();
    const dailyByDay = dailyGrossByStaffId.get(id) || Array(numDays).fill(0);
    const weeklyGross = roundMoney(dailyByDay.reduce((sum, v) => sum + (Number(v) || 0), 0));
    const tardinessMinutes = s.subjectToTardiness ? (tardinessMap.get(s.name.trim()) ?? 0) : 0;
    const deductionPercent = s.subjectToTardiness ? getTardinessDeductionPercent(tardinessMinutes) : 0;
    const tardinessDeductionAmount = roundMoney(weeklyGross * deductionPercent);
    const weeklyAfterTardiness = roundMoney(weeklyGross - tardinessDeductionAmount);
    const manual = manualMap.get(id) || { amount: 0, reason: '' };
    const netWeekly = roundMoney(Math.max(0, weeklyAfterTardiness - manual.amount));
    rows.push({
      productionStaffId: s._id,
      name: s.name,
      allocationPercent: s.allocationPercent,
      subjectToTardiness: s.subjectToTardiness,
      weeklyGrossProductionTips: weeklyGross,
      dailyByDay,
      weeklyTardinessMinutes: tardinessMinutes,
      tardinessPercent: deductionPercent * 100,
      tardinessDeduction: tardinessDeductionAmount,
      weeklyAfterTardiness,
      manualDeduction: manual.amount,
      manualDeductionReason: manual.reason,
      netWeeklyProductionTips: netWeekly,
      eligibleForRedistribution: (tardinessMinutes <= 5 || !s.subjectToTardiness) && weeklyGross > 0,
    });
  }

  const totalRedistributionPool = rows.reduce((sum, r) => sum + r.tardinessDeduction, 0);
  const eligible = rows.filter((r) => r.eligibleForRedistribution);
  const equalShareWeight = () => 1;
  const redistributionByStaffId = allocateCentsProportionally(
    eligible,
    totalRedistributionPool,
    equalShareWeight,
    (r) => r.productionStaffId?.toString?.() || '',
  );

  for (const row of rows) {
    const id = row.productionStaffId?.toString?.() || '';
    row.tardinessRedistribution = redistributionByStaffId.get(id) || 0;
    row.finalWeeklyProductionPayout = roundMoney(row.netWeeklyProductionTips + row.tardinessRedistribution);
  }

  return {
    weekStart: weekStartForManual,
    weekEnd: weekEndStr,
    ...(useDateRange && { dateRange: { startDate: options.startDate.trim().slice(0, 10), endDate: options.endDate.trim().slice(0, 10) } }),
    locationWisePool: locationWise,
    redistributionPool: roundMoney(totalRedistributionPool),
    payouts: rows.map((r) => ({
      productionStaffId: r.productionStaffId,
      name: r.name,
      allocationPercent: r.allocationPercent,
      subjectToTardiness: r.subjectToTardiness,
      weeklyGrossProductionTips: r.weeklyGrossProductionTips,
      dailyByDay: r.dailyByDay,
      weeklyTardinessMinutes: r.weeklyTardinessMinutes,
      tardinessPercent: r.tardinessPercent,
      tardinessDeduction: r.tardinessDeduction,
      weeklyAfterTardiness: r.weeklyAfterTardiness,
      manualDeduction: r.manualDeduction,
      manualDeductionReason: r.manualDeductionReason,
      netWeeklyProductionTips: r.netWeeklyProductionTips,
      tardinessRedistribution: r.tardinessRedistribution,
      finalWeeklyProductionPayout: r.finalWeeklyProductionPayout,
    })),
  };
}

async function upsertProductionManualDeduction(productionStaffId, weekStart, amount, reason) {
  const weekStartStr = typeof weekStart === 'string' ? weekStart.slice(0, 10) : toDateString(weekStart);
  return ProductionManualDeduction.findOneAndUpdate(
    { productionStaffId, weekStart: weekStartStr },
    { amount: Number(amount) || 0, reason: (reason || '').trim() },
    { upsert: true, new: true }
  ).populate('productionStaffId');
}

async function getProductionManualDeductions(weekStart) {
  const weekStartStr = typeof weekStart === 'string' ? weekStart.slice(0, 10) : toDateString(weekStart);
  return ProductionManualDeduction.find({ weekStart: weekStartStr })
    .populate('productionStaffId')
    .lean();
}

module.exports = {
  getDailyProductionPool,
  getLocationWiseProductionPool,
  getProductionStaff,
  getWeeklyProductionPayout,
  upsertProductionManualDeduction,
  getProductionManualDeductions,
};
