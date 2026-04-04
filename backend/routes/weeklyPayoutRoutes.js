const express = require('express');
const { param, body } = require('express-validator');
const weeklyPayoutController = require('../controllers/weeklyPayoutController');
const validate = require('../middlewares/validate');

const router = express.Router();

/** Accept YYYY-MM-DD (Monday date) for weekStart */
const weekStartParam = param('weekStart')
  .matches(/^\d{4}-\d{2}-\d{2}$/)
  .withMessage('weekStart must be YYYY-MM-DD (Monday)');
const weekStartBody = body('weekStart')
  .matches(/^\d{4}-\d{2}-\d{2}$/)
  .withMessage('weekStart must be YYYY-MM-DD');

router.post(
  '/report',
  body('startDate')
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('startDate must be YYYY-MM-DD'),
  body('endDate')
    .matches(/^\d{4}-\d{2}-\d{2}$/)
    .withMessage('endDate must be YYYY-MM-DD'),
  body('geographicScope')
    .isIn(['one_location', 'all_locations'])
    .withMessage('Invalid geographicScope'),
  body('employeeScope')
    .isIn(['all', 'one_employee'])
    .withMessage('Invalid employeeScope'),
  body('singleLocationId').optional({ values: 'falsy' }).isMongoId(),
  body('employeeName').optional({ values: 'falsy' }).isString(),
  body().custom((_, { req }) => {
    const { geographicScope, singleLocationId, employeeScope, employeeName } =
      req.body || {};
    if (geographicScope === 'one_location' && !singleLocationId) {
      throw new Error('singleLocationId is required for one-location scope');
    }
    if (
      employeeScope === 'one_employee' &&
      !(employeeName && String(employeeName).trim())
    ) {
      throw new Error('employeeName is required for single-employee scope');
    }
    return true;
  }),
  validate,
  weeklyPayoutController.postReport,
);

router.get(
  '/:locationId/:weekStart',
  param('locationId').isMongoId(),
  weekStartParam,
  validate,
  weeklyPayoutController.getPayout
);
router.get(
  '/:locationId/:weekStart/tardiness',
  param('locationId').isMongoId(),
  weekStartParam,
  validate,
  weeklyPayoutController.getTardiness
);
router.post(
  '/tardiness',
  body('employeeId').isMongoId(),
  body('locationId').isMongoId(),
  weekStartBody,
  body('totalTardinessMinutes').isFloat({ min: 0 }),
  validate,
  weeklyPayoutController.upsertTardiness
);
router.get(
  '/:locationId/:weekStart/manual-deductions',
  param('locationId').isMongoId(),
  weekStartParam,
  validate,
  weeklyPayoutController.getManualDeductions
);
router.post(
  '/manual-deduction',
  body('employeeId').isMongoId(),
  body('locationId').isMongoId(),
  weekStartBody,
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
