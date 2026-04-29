const express = require('express');
const { body, param, query } = require('express-validator');
const dailyTipController = require('../controllers/dailyTipController');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/history', dailyTipController.getHistory);
router.get('/pending-calculation', dailyTipController.getPendingCalculation);
router.post('/calculate-all-pending', dailyTipController.calculateAllPending);
router.get(
  '/weekly-final-payable-summary',
  query('startDate').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('startDate must be YYYY-MM-DD'),
  query('endDate').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('endDate must be YYYY-MM-DD'),
  validate,
  dailyTipController.getWeeklyFinalPayableSummary,
);

router.get(
  '/:locationId/:date',
  param('locationId').isMongoId(),
  param('date').isISO8601().withMessage('Valid date required'),
  validate,
  dailyTipController.getByLocationAndDate
);
router.get(
  '/:locationId/:date/calculation',
  param('locationId').isMongoId(),
  param('date').isISO8601().withMessage('Valid date required'),
  query('refresh').optional().isString(),
  validate,
  dailyTipController.getCalculation
);
router.get(
  '/:locationId/:date/adjustments',
  param('locationId').isMongoId(),
  param('date').isISO8601().withMessage('Valid date required'),
  validate,
  dailyTipController.getAdjustments
);
router.put(
  '/:locationId/:date',
  param('locationId').isMongoId(),
  param('date').isISO8601().withMessage('Valid date required'),
  body('amGrossTips').isFloat({ min: 0 }).withMessage('AM gross tips must be >= 0'),
  body('pmGrossTips').optional().isFloat({ min: 0 }).withMessage('PM gross tips must be >= 0'),
  validate,
  dailyTipController.upsert
);
router.post(
  '/:locationId/:date/adjustment',
  param('locationId').isMongoId(),
  param('date').isISO8601().withMessage('Valid date required'),
  body('employeeId').isMongoId().withMessage('Valid employeeId required'),
  body('type').isIn(['cash_advance', 'redistribute_equal']).withMessage('Valid adjustment type required'),
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be >= 0'),
  body('reason').optional().isString(),
  validate,
  dailyTipController.upsertAdjustment
);

module.exports = router;
