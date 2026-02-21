const mongoose = require('mongoose');

/** Per-day breakdown: date (YYYY-MM-DD day at midnight UTC), workingMinutes, tardinessMinutes */
const dailyBreakdownSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },
    workingMinutes: { type: Number, default: 0, min: 0 },
    tardinessMinutes: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const weeklyTardinessSchema = new mongoose.Schema(
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
    /** End of range (inclusive). When set, this record is for the range [weekStart, weekEnd]; when omitted, legacy week is Mon–Sun. */
    weekEnd: {
      type: Date,
      default: null,
    },
    totalTardinessMinutes: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Total working minutes for the period (from clock-in/clock-out). */
    totalWorkingMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Per-day breakdown so we know e.g. employee worked 478 min on 12 Jan, 488 min on 13 Jan. */
    dailyBreakdown: {
      type: [dailyBreakdownSchema],
      default: [],
    },
  },
  { timestamps: true }
);

weeklyTardinessSchema.index({ locationId: 1, weekStart: 1, weekEnd: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyTardiness', weeklyTardinessSchema);
