const mongoose = require('mongoose');

/**
 * Production staff receive a fixed allocation % of the daily production pool.
 * subjectToTardiness: false = senior/exempt (e.g. Laura), true = tardiness rules apply.
 */
const productionStaffSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    allocationPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    subjectToTardiness: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

productionStaffSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('ProductionStaff', productionStaffSchema);
