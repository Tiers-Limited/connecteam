const mongoose = require('mongoose');

/**
 * Manual deduction for a production staff member for a given week (Mon–Sun).
 * Production is global (no locationId). weekStart = Monday YYYY-MM-DD.
 */
const productionManualDeductionSchema = new mongoose.Schema(
  {
    productionStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductionStaff',
      required: true,
    },
    weekStart: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

productionManualDeductionSchema.index({ productionStaffId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('ProductionManualDeduction', productionManualDeductionSchema);
