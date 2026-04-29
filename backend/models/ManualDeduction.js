const mongoose = require('mongoose');

const manualDeductionSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    weekStart: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    additionalTips: {
      type: Number,
      default: 0,
      min: 0,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

manualDeductionSchema.index({ locationId: 1, weekStart: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model('ManualDeduction', manualDeductionSchema);
