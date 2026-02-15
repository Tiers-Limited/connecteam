const ProductionStaff = require('../models/ProductionStaff');

/** Full names must match Weekly Tardiness (Connecteam) employee names for tardiness lookup. */
const DEFAULT_STAFF = [
  { name: 'Mariana ZAP ZAPATA DIAZ', allocationPercent: 1.0, subjectToTardiness: true },
  { name: 'Laura MORENO PARRADO', allocationPercent: 1.5, subjectToTardiness: false },
  { name: 'Bruna GARCIA SOARES DA SILVA', allocationPercent: 1.0, subjectToTardiness: true },
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
        name: row.name,
        allocationPercent: row.allocationPercent,
        subjectToTardiness: row.subjectToTardiness,
        isActive: true,
      },
      { upsert: true, new: true }
    );
  }
}

module.exports = { seedProductionStaff };
