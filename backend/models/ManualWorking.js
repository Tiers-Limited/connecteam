const mongoose = require('mongoose');

const manualWorkingSchema = new mongoose.Schema(
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
    date: {
      type: Date,
      required: true,
    },
    amHours: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    pmHours: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    /** When set, amHours/pmHours are derived from these using the same AM/PM split as Connecteam. */
    clockIn: { type: String, default: '' },
    clockOut: { type: String, default: '' },
    amTips: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    pmTips: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

manualWorkingSchema.index({ locationId: 1, date: 1, employeeId: 1 });
manualWorkingSchema.index({ locationId: 1, date: 1 });

module.exports = mongoose.model('ManualWorking', manualWorkingSchema);
