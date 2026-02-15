/**
 * One-time fix: drop stale index staff_1_weekStartDate_1 from productionmanualdeductions.
 * That index was from an old schema; current schema uses productionStaffId + weekStart.
 * Run: node backend/scripts/dropProductionManualDeductionStaleIndex.js
 */
require('dotenv').config();
const connectDB = require('../config/db');
const mongoose = require('mongoose');

async function run() {
  await connectDB();
  const collection = mongoose.connection.collection('productionmanualdeductions');
  const indexes = await collection.indexes();
  const hasStale = indexes.some((idx) => idx.name === 'staff_1_weekStartDate_1');
  if (hasStale) {
    await collection.dropIndex('staff_1_weekStartDate_1');
    console.log('Dropped stale index staff_1_weekStartDate_1');
  } else {
    console.log('No stale index found (already dropped or never existed)');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
