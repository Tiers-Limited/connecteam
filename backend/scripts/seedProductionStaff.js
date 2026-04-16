const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const ProductionStaff = require('../models/ProductionStaff');

/** Full names must match Weekly Tardiness (Connecteam) employee names for tardiness lookup. */
const DEFAULT_STAFF = [
  { name: 'Mariana ZAP ZAPATA DIAZ', allocationPercent: 30, subjectToTardiness: true },
  { name: 'Laura MORENO PARRADO', allocationPercent: 40, subjectToTardiness: false },
  { name: 'Bruna GARCIA SOARES DA SILVA', allocationPercent: 30, subjectToTardiness: true },
];

async function seedProductionStaff() {
  await ProductionStaff.updateMany(
    { name: { $in: ['Marina', 'Laura', 'Bruna'] } },
    { isActive: false }
  );
  for (const row of DEFAULT_STAFF) {
    await ProductionStaff.findOneAndUpdate(
      { name: row.name },
      {
        $setOnInsert: {
          name: row.name,
          allocationPercent: row.allocationPercent,
          subjectToTardiness: row.subjectToTardiness,
        },
        $set: {
          // Keep custom allocation/tardiness edits; only ensure staff is active.
          isActive: true,
        },
      },
      { upsert: true, new: true }
    );
  }
}

async function main() {
  await connectDB();
  await seedProductionStaff();
  const count = await ProductionStaff.countDocuments({ isActive: true });
  console.log('Production staff seed complete. Active documents:', count);
  DEFAULT_STAFF.forEach((row) => console.log('  -', row.name));
  await mongoose.disconnect();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('seedProductionStaff failed:', err);
    process.exit(1);
  });
}

module.exports = { seedProductionStaff, DEFAULT_STAFF };
