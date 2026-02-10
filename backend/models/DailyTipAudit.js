const mongoose = require('mongoose');

/**
 * Audit snapshot for tips calculation per location + date.
 * Stores raw (deduplicated entries), derived (hours), and financial data for reproducibility.
 */
const dailyTipAuditSchema = new mongoose.Schema(
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
    raw: {
      deduplicatedEntries: [
        {
          employeeId: mongoose.Schema.Types.ObjectId,
          employeeName: String,
          clockIn: String,
          clockOut: String,
        },
      ],
    },
    derived: {
      employeeHours: [
        {
          employeeId: mongoose.Schema.Types.ObjectId,
          employeeName: String,
          amHours: Number,
          pmHours: Number,
        },
      ],
      totalAMHours: Number,
      totalPMHours: Number,
    },
    financial: {
      amGrossTips: Number,
      pmGrossTips: Number,
      productionDeductionAM: Number,
      productionDeductionPM: Number,
      distributableAM: Number,
      distributablePM: Number,
      amTipRate: Number,
      pmTipRate: Number,
      employeePayouts: [
        {
          employeeId: mongoose.Schema.Types.ObjectId,
          employeeName: String,
          amTips: Number,
          pmTips: Number,
          totalTips: Number,
        },
      ],
    },
  },
  { timestamps: true }
);

dailyTipAuditSchema.index({ locationId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyTipAudit', dailyTipAuditSchema);
