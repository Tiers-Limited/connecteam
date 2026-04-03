/**
 * One-time: drop old connecteamsUserId+locationId unique index (sparse) and apply the
 * new partial unique index from models/Employee.js (allows many manual-only employees per location).
 *
 * Run from repo root: node backend/scripts/fixEmployeeConnecteamsIndex.js
 * Run from backend:   node scripts/fixEmployeeConnecteamsIndex.js
 *
 * Loads backend/.env regardless of current working directory (dotenv defaults to cwd only).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const connectDB = require('../config/db');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');

async function run() {
  await connectDB();
  const collection = mongoose.connection.collection('employees');
  const indexes = await collection.indexes();
  const name = 'connecteamsUserId_1_locationId_1';
  if (indexes.some((idx) => idx.name === name)) {
    await collection.dropIndex(name);
    console.log('Dropped index:', name);
  } else {
    console.log('Old index not present (already migrated or different name).');
  }
  await Employee.syncIndexes();
  console.log('Employee indexes synced (partial unique on connecteamsUserId + locationId).');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
