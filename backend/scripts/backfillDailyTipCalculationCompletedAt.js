/**
 * One-time: set calculationCompletedAt on every DailyTipInput except tips whose
 * calendar day (in app TIMEZONE) is 2026-01-27 or 2026-02-13.
 *
 * Default timestamp matches a known completion instant; override with env BACKFILL_CALCULATION_COMPLETED_AT (ISO string).
 *
 * Run from repo root: node backend/scripts/backfillDailyTipCalculationCompletedAt.js
 * Run from backend:   node scripts/backfillDailyTipCalculationCompletedAt.js
 *
 * Loads backend/.env regardless of current working directory (dotenv defaults to cwd only).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const DailyTipInput = require('../models/DailyTipInput');
const { formatDateStringInTimezone, getAppTimezone } = require('../utils/dateUtils');

const EXCLUDED_YMD = new Set(['2026-01-27', '2026-02-13']);

const DEFAULT_STAMP = new Date('2026-04-03T17:47:40.607Z');

function completionTimestamp() {
  const raw = process.env.BACKFILL_CALCULATION_COMPLETED_AT;
  if (raw && String(raw).trim()) {
    const d = new Date(String(raw).trim());
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid BACKFILL_CALCULATION_COMPLETED_AT: ${raw}`);
    }
    return d;
  }
  return DEFAULT_STAMP;
}

async function run() {
  if (!process.env.MONGODB_URI) {
    console.warn(
      'MONGODB_URI is not set; using default mongodb://localhost:27017/connectteam',
    );
    console.warn(
      'If you see ECONNREFUSED, start MongoDB locally or set MONGODB_URI in backend/.env.',
    );
  }
  await connectDB();
  const stamp = completionTimestamp();
  const tz = getAppTimezone();
  console.log(`App timezone: ${tz}`);
  console.log(`Excluded calendar days: ${[...EXCLUDED_YMD].join(', ')}`);
  console.log(`Setting calculationCompletedAt to: ${stamp.toISOString()}`);

  const docs = await DailyTipInput.find({}).select('_id date').lean();
  let updated = 0;
  let skippedExcluded = 0;
  let unchanged = 0;

  for (const doc of docs) {
    const ymd = formatDateStringInTimezone(new Date(doc.date).getTime(), tz);
    if (EXCLUDED_YMD.has(ymd)) {
      skippedExcluded += 1;
      continue;
    }
    const res = await DailyTipInput.updateOne(
      { _id: doc._id },
      { $set: { calculationCompletedAt: stamp } },
    );
    if (res.modifiedCount > 0) updated += 1;
    else unchanged += 1;
  }

  console.log(`Total documents: ${docs.length}`);
  console.log(`Skipped (excluded dates): ${skippedExcluded}`);
  console.log(`Updated (modified): ${updated}`);
  console.log(`Matched but not modified (already same value): ${unchanged}`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
