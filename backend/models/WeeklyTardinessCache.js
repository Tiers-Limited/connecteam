const mongoose = require('mongoose');

/**
 * DB collection: persisted weekly tardiness data (from Connecteam via Weekly Tardiness page).
 * Key: weekStart (YYYY-MM-DD) + locationId (ObjectId or null for "all locations").
 * payload: { entries, dailyTotals, weekTotal }. Production Pool and front staff read from here.
 */
const weeklyTardinessCacheSchema = new mongoose.Schema(
  {
    weekStart: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
    },
    /** Full payload: { entries, dailyTotals, weekTotal } */
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true }
);

weeklyTardinessCacheSchema.index({ weekStart: 1, locationId: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyTardinessCache', weeklyTardinessCacheSchema);
