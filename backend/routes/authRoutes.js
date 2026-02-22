const express = require('express');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Supervisor = require('../models/Supervisor');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { sendResetPinEmail } = require('../services/emailService');
const { jwtSecret, jwtExpiresIn } = require('../config/env');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const admin = await Admin.findOne({ email: normalizedEmail }).select('+password');
    if (admin) {
      const match = await admin.comparePassword(password);
      if (match) {
        const user = await Admin.findById(admin._id).select('-password');
        const token = jwt.sign(
          { userId: user._id.toString(), role: 'admin' },
          jwtSecret,
          { expiresIn: jwtExpiresIn }
        );
        return res.json({
          user: { _id: user._id, email: user.email, role: user.role },
          token,
        });
      }
    }

    const supervisor = await Supervisor.findOne({ email: normalizedEmail }).select('+password');
    if (supervisor) {
      const match = await supervisor.comparePassword(password);
      if (match) {
        const user = await Supervisor.findById(supervisor._id).select('-password');
        const token = jwt.sign(
          { userId: user._id.toString(), role: 'supervisor' },
          jwtSecret,
          { expiresIn: jwtExpiresIn }
        );
        return res.json({
          user: { _id: user._id, email: user.email, username: user.username, role: user.role },
          token,
        });
      }
    }

    return res.status(401).json({ message: 'Invalid email or password' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Login failed' });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  return res.json({ user: req.user });
});

router.post('/logout', (_, res) => {
  return res.json({ message: 'Logged out' });
});

router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    const isAdmin = req.user.role === 'admin';
    const Model = isAdmin ? Admin : Supervisor;
    const user = await Model.findById(req.user._id).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    const match = await user.comparePassword(currentPassword);
    if (!match) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    user.password = newPassword;
    await user.save();
    return res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ message: 'Failed to change password' });
  }
});

const PIN_EXPIRY_MINUTES = 10;
const PIN_LENGTH = 6;

function generatePin() {
  let pin = '';
  for (let i = 0; i < PIN_LENGTH; i++) {
    pin += Math.floor(Math.random() * 10);
  }
  return pin;
}

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || !String(email).trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    let user = await Admin.findOne({ email: normalizedEmail });
    if (!user) {
      user = await Supervisor.findOne({ email: normalizedEmail });
    }
    if (!user) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    const pin = generatePin();
    user.resetPin = pin;
    user.resetPinExpiresAt = new Date(Date.now() + PIN_EXPIRY_MINUTES * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    try {
      await sendResetPinEmail(normalizedEmail, pin);
    } catch (emailErr) {
      console.error('Failed to send reset PIN email:', emailErr);
      return res.status(500).json({
        message: 'Could not send email. Check EMAIL_USER, EMAIL_PASS, and EMAIL_FROM in server configuration.',
      });
    }

    return res.json({
      message: 'If an account exists with this email, a PIN has been sent. Check your inbox and use it to reset your password.',
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ message: 'Failed to request reset PIN' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, pin, newPassword } = req.body || {};
    if (!email || !String(email).trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }
    if (!pin || String(pin).length !== PIN_LENGTH) {
      return res.status(400).json({ message: 'Valid 6-digit PIN is required' });
    }
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();

    let user = await Admin.findOne({ email: normalizedEmail }).select('+password +resetPin +resetPinExpiresAt');
    if (!user) {
      user = await Supervisor.findOne({ email: normalizedEmail }).select('+password +resetPin +resetPinExpiresAt');
    }
    if (!user) {
      return res.status(404).json({ message: 'No account found with this email' });
    }
    if (!user.resetPin || !user.resetPinExpiresAt) {
      return res.status(400).json({ message: 'No reset PIN requested or PIN expired. Request a new PIN.' });
    }
    if (user.resetPin !== String(pin)) {
      return res.status(400).json({ message: 'Invalid PIN' });
    }
    if (new Date() > user.resetPinExpiresAt) {
      user.resetPin = undefined;
      user.resetPinExpiresAt = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(400).json({ message: 'PIN has expired. Request a new PIN.' });
    }
    user.password = newPassword;
    user.resetPin = undefined;
    user.resetPinExpiresAt = undefined;
    await user.save();
    return res.json({ message: 'Password reset successfully. You can sign in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ message: 'Failed to reset password' });
  }
});

module.exports = router;
