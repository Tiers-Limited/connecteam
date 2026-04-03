const mongoose = require('mongoose');

const dailyTipInputSchema = new mongoose.Schema(
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
    amGrossTips: {
      type: Number,
      required: true,
      min: 0,
    },
    pmGrossTips: {
      type: Number,
      required: true,
      min: 0,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdByEmail: { type: String, default: '' },
    createdByUsername: { type: String, default: '' },
    createdByRole: { type: String, enum: ['admin', 'supervisor'], default: '' },
    /** Set when daily tip calculation completes successfully; cleared when gross tips are saved/updated. */
    calculationCompletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

dailyTipInputSchema.index({ locationId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyTipInput', dailyTipInputSchema);
