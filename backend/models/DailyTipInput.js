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
  },
  { timestamps: true }
);

dailyTipInputSchema.index({ locationId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyTipInput', dailyTipInputSchema);
