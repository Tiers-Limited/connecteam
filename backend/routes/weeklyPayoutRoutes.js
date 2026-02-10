const express = require('express');
const { param, body } = require('express-validator');
const weeklyPayoutController = require('../controllers/weeklyPayoutController');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get(
  '/:locationId/:weekStart',
  param('locationId').isMongoId(),
  param('weekStart').isISO8601().withMessage('weekStart must be ISO date (Monday)'),
  validate,
  weeklyPayoutController.getPayout
);
router.get(
  '/:locationId/:weekStart/tardiness',
  param('locationId').isMongoId(),
  param('weekStart').isISO8601(),
  validate,
  weeklyPayoutController.getTardiness
);
router.post(
  '/tardiness',
  body('employeeId').isMongoId(),
  body('locationId').isMongoId(),
  body('weekStart').isISO8601(),
  body('totalTardinessMinutes').isFloat({ min: 0 }),
  validate,
  weeklyPayoutController.upsertTardiness
);
router.get(
  '/:locationId/:weekStart/manual-deductions',
  param('locationId').isMongoId(),
  param('weekStart').isISO8601(),
  validate,
  weeklyPayoutController.getManualDeductions
);
router.post(
  '/manual-deduction',
  body('employeeId').isMongoId(),
  body('locationId').isMongoId(),
  body('weekStart').isISO8601(),
  body('amount').isFloat({ min: 0 }),
  body('reason').custom((value, { req }) => {
    if (Number(req.body?.amount) > 0 && !(value && String(value).trim())) {
      throw new Error('Reason is required when amount > 0');
    }
    return true;
  }),
  validate,
  weeklyPayoutController.upsertManualDeduction
);

module.exports = router;
