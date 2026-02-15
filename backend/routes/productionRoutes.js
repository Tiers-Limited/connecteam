const express = require('express');
const { param, body } = require('express-validator');
const productionController = require('../controllers/productionController');
const validate = require('../middlewares/validate');

const router = express.Router();

router.get('/staff', productionController.getStaff);
router.patch(
  '/staff/:id',
  param('id').isMongoId(),
  body('allocationPercent').optional().isFloat({ min: 0, max: 100 }),
  body('subjectToTardiness').optional().isBoolean(),
  validate,
  productionController.updateStaff
);
router.get(
  '/weekly-payout/:weekStart',
  param('weekStart').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('weekStart must be YYYY-MM-DD (Monday)'),
  validate,
  productionController.getWeeklyPayout
);
router.get(
  '/daily-pool/:date',
  param('date').matches(/^\d{4}-\d{2}-\d{2}$/),
  validate,
  productionController.getDailyPool
);
router.get(
  '/manual-deductions/:weekStart',
  param('weekStart').matches(/^\d{4}-\d{2}-\d{2}$/),
  validate,
  productionController.getManualDeductions
);
router.post(
  '/manual-deduction',
  body('productionStaffId').isMongoId(),
  body('weekStart').matches(/^\d{4}-\d{2}-\d{2}$/),
  body('amount').isFloat({ min: 0 }),
  body('reason').custom((value, { req }) => {
    if (Number(req.body?.amount) > 0 && !(value && String(value).trim())) {
      throw new Error('Reason is required when amount > 0');
    }
    return true;
  }),
  validate,
  productionController.upsertManualDeduction
);

module.exports = router;
