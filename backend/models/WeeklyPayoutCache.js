const mongoose = require('mongoose');

/**
 * Cached weekly payout result for a location and week.
 * Key: locationId + weekStart (YYYY-MM-DD). Load from here first; recompute and save on miss or when invalidated (e.g. after manual deduction).
 */
const weeklyPayoutCacheSchema = new mongoose.Schema(
  {
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    weekStart: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    /** Full payout result: { locationId, locationName, weekStart, weekEnd, redistributionPool, eligibleTotalHours, payouts } */
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true }
);

weeklyPayoutCacheSchema.index({ locationId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyPayoutCache', weeklyPayoutCacheSchema);
