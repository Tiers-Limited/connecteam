const mongoose = require('mongoose');

const dailyTipAdjustmentSchema = new mongoose.Schema(
  {
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['cash_advance', 'redistribute_equal', 'exclude'],
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
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdByEmail: { type: String, default: '' },
    createdByUsername: { type: String, default: '' },
    createdByRole: { type: String, enum: ['admin', 'supervisor'], default: '' },
  },
  { timestamps: true }
);

dailyTipAdjustmentSchema.index(
  { locationId: 1, date: 1, employeeId: 1, type: 1 },
  { unique: true }
);

module.exports = mongoose.model('DailyTipAdjustment', dailyTipAdjustmentSchema);

