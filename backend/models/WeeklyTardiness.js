const mongoose = require('mongoose');

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
    totalTardinessMinutes: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Total working minutes for the week (from clock-in/clock-out). */
    totalWorkingMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

weeklyTardinessSchema.index({ locationId: 1, weekStart: 1, employeeId: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyTardiness', weeklyTardinessSchema);
