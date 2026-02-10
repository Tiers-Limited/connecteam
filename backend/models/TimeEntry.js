const mongoose = require('mongoose');

const timeEntrySchema = new mongoose.Schema(
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
    clockIn: {
      type: String,
      required: true,
      match: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
    },
    clockOut: {
      type: String,
      required: true,
      match: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
    },
    scheduledTime: {
      type: String,
      match: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/,
    },
  },
  { timestamps: true }
);

timeEntrySchema.index({ locationId: 1, date: 1, employeeId: 1 });

module.exports = mongoose.model('TimeEntry', timeEntrySchema);
