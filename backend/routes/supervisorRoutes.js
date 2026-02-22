const express = require('express');
const Supervisor = require('../models/Supervisor');
const { requireAdmin } = require('../middlewares/authMiddleware');
const { sendSupervisorCredentials } = require('../services/emailService');

const router = express.Router();

function generatePassword() {
  const length = 12;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

router.use(requireAdmin);

router.post('/', async (req, res) => {
  try {
    const { email, username } = req.body || {};
    const trimmedEmail = email ? String(email).trim().toLowerCase() : '';
    const trimmedUsername = username ? String(username).trim() : '';
    if (!trimmedEmail) {
      return res.status(400).json({ message: 'Email is required' });
    }
    if (!trimmedUsername) {
      return res.status(400).json({ message: 'Username is required' });
    }
    const existing = await Supervisor.findOne({ email: trimmedEmail });
    if (existing) {
      return res.status(400).json({ message: 'A supervisor with this email already exists' });
    }
    const password = generatePassword();
    const supervisor = new Supervisor({
      email: trimmedEmail,
      username: trimmedUsername,
      password,
      role: 'supervisor',
    });
    await supervisor.save();
    try {
      await sendSupervisorCredentials(trimmedEmail, trimmedUsername, password);
    } catch (emailErr) {
      console.error('Failed to send supervisor email:', emailErr);
      return res.status(500).json({
        message: 'Supervisor created but failed to send credentials email. Check EMAIL_USER, EMAIL_PASS, and EMAIL_FROM in .env.',
      });
    }
    const created = await Supervisor.findById(supervisor._id).select('-password');
    return res.status(201).json({
      message: 'Supervisor created. Credentials have been sent to their email.',
      supervisor: created,
    });
  } catch (err) {
    console.error('Create supervisor error:', err);
    return res.status(500).json({ message: 'Failed to create supervisor' });
  }
});

router.get('/', async (req, res) => {
  try {
    const list = await Supervisor.find().select('-password').sort({ createdAt: -1 });
    return res.json(list);
  } catch (err) {
    console.error('List supervisors error:', err);
    return res.status(500).json({ message: 'Failed to list supervisors' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, username } = req.body || {};
    const trimmedEmail = email != null ? String(email).trim().toLowerCase() : '';
    const trimmedUsername = username != null ? String(username).trim() : '';
    const supervisor = await Supervisor.findById(id);
    if (!supervisor) {
      return res.status(404).json({ message: 'Supervisor not found' });
    }
    if (trimmedEmail) {
      const existing = await Supervisor.findOne({ email: trimmedEmail, _id: { $ne: id } });
      if (existing) {
        return res.status(400).json({ message: 'A supervisor with this email already exists' });
      }
      supervisor.email = trimmedEmail;
    }
    if (trimmedUsername) supervisor.username = trimmedUsername;
    await supervisor.save();
    const updated = await Supervisor.findById(id).select('-password');
    return res.json(updated);
  } catch (err) {
    console.error('Update supervisor error:', err);
    return res.status(500).json({ message: 'Failed to update supervisor' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const supervisor = await Supervisor.findByIdAndDelete(id);
    if (!supervisor) {
      return res.status(404).json({ message: 'Supervisor not found' });
    }
    return res.json({ message: 'Supervisor deleted' });
  } catch (err) {
    console.error('Delete supervisor error:', err);
    return res.status(500).json({ message: 'Failed to delete supervisor' });
  }
});

module.exports = router;
