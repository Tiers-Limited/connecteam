const express = require('express');
const authRoutes = require('./authRoutes');
const locationRoutes = require('./locationRoutes');
const employeeRoutes = require('./employeeRoutes');
const dailyTipRoutes = require('./dailyTipRoutes');
const timeEntryRoutes = require('./timeEntryRoutes');
const weeklyPayoutRoutes = require('./weeklyPayoutRoutes');
const connecteamsRoutes = require('./connecteamsRoutes');
const productionRoutes = require('./productionRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const supervisorRoutes = require('./supervisorRoutes');
const manualWorkingRoutes = require('./manualWorkingRoutes');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/', (req, res) => res.json({ ok: true, message: 'Corvia Tips API' }));
router.use('/auth', authRoutes);

router.use(authMiddleware);
router.use('/dashboard', dashboardRoutes);
router.use('/locations', locationRoutes);
router.use('/employees', employeeRoutes);
router.use('/daily-tips', dailyTipRoutes);
router.use('/time-entries', timeEntryRoutes);
router.use('/weekly-payout', weeklyPayoutRoutes);
router.use('/connecteams', connecteamsRoutes);
router.use('/production', productionRoutes);
router.use('/supervisors', supervisorRoutes);
router.use('/manual-working', manualWorkingRoutes);

module.exports = router;
