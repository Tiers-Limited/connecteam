const express = require('express');
const locationRoutes = require('./locationRoutes');
const employeeRoutes = require('./employeeRoutes');
const dailyTipRoutes = require('./dailyTipRoutes');
const timeEntryRoutes = require('./timeEntryRoutes');
const weeklyPayoutRoutes = require('./weeklyPayoutRoutes');
const connecteamsRoutes = require('./connecteamsRoutes');

const router = express.Router();

router.get('/', (req, res) => res.json({ ok: true, message: 'ConnectTeam API' }));
router.use('/locations', locationRoutes);
router.use('/employees', employeeRoutes);
router.use('/daily-tips', dailyTipRoutes);
router.use('/time-entries', timeEntryRoutes);
router.use('/weekly-payout', weeklyPayoutRoutes);
router.use('/connecteams', connecteamsRoutes);

module.exports = router;
