const express = require('express');
const { body, param } = require('express-validator');
const dailyTipController = require('../controllers/dailyTipController');
const validate = require('../middlewares/validate');
const { requireAdmin } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/history', requireAdmin, dailyTipController.getHistory);

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
  validate,
  dailyTipController.getCalculation
);
router.put(
  '/:locationId/:date',
  param('locationId').isMongoId(),
  param('date').isISO8601().withMessage('Valid date required'),
  body('amGrossTips').isFloat({ min: 0 }).withMessage('AM gross tips must be >= 0'),
  body('pmGrossTips').isFloat({ min: 0 }).withMessage('PM gross tips must be >= 0'),
  validate,
  dailyTipController.upsert
);

module.exports = router;
