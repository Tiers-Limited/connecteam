const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      required: true,
    },
    connecteamsUserId: {
      type: String,
      trim: true,
      sparse: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    /** When set, daily tip pool uses this multiplier instead of the job-title default from constants. */
    tipMultiplierOverride: {
      type: Number,
      min: 0.01,
      max: 100,
    },
  },
  { timestamps: true }
);

employeeSchema.index({ locationId: 1, name: 1 });
/**
 * Uniqueness only when Connecteam id is a non-empty string.
 * Sparse unique on null is wrong: MongoDB still indexes explicit null, so only one
 * manual (no Connecteam) employee per location could exist — use partial index instead.
 */
employeeSchema.index(
  { connecteamsUserId: 1, locationId: 1 },
  {
    unique: true,
    partialFilterExpression: { connecteamsUserId: { $type: 'string', $gt: '' } },
  }
);

module.exports = mongoose.model('Employee', employeeSchema);
