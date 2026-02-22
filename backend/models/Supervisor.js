const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const supervisorSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    username: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ['supervisor'],
      default: 'supervisor',
    },
    resetPin: { type: String, select: false },
    resetPinExpiresAt: { type: Date, select: false },
  },
  { timestamps: true }
);

supervisorSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

supervisorSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Supervisor', supervisorSchema);
