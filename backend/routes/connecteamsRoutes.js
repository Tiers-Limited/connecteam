const express = require('express');
const { query } = require('express-validator');
const connecteamsController = require('../controllers/connecteamsController');
const validate = require('../middlewares/validate');

const router = express.Router();

router.post(
  '/sync',
  query('startDate').notEmpty().withMessage('startDate required (YYYY-MM-DD)'),
  query('endDate').notEmpty().withMessage('endDate required (YYYY-MM-DD)'),
  validate,
  connecteamsController.syncFromConnecteams
);

router.get(
  '/weekly-tardiness',
  query('weekStart').notEmpty().withMessage('weekStart required (YYYY-MM-DD, Monday)'),
  validate,
  connecteamsController.getWeeklyTardiness
);

router.get(
  '/clock-in-times',
  query('userId').notEmpty().withMessage('userId required (Connecteam user id)'),
  query('startDate').notEmpty().withMessage('startDate required (YYYY-MM-DD)'),
  query('endDate').notEmpty().withMessage('endDate required (YYYY-MM-DD)'),
  validate,
  connecteamsController.getClockInTimes
);

module.exports = router;
