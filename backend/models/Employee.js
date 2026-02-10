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
  },
  { timestamps: true }
);

employeeSchema.index({ locationId: 1, name: 1 });
employeeSchema.index({ connecteamsUserId: 1, locationId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Employee', employeeSchema);
