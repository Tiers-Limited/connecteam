const express = require('express');
const { param, body } = require('express-validator');
const employeeController = require('../controllers/employeeController');
const validate = require('../middlewares/validate');

const router = express.Router();

// Employees come from Connecteams sync; tip multiplier override is editable for daily tips.
router.get('/', employeeController.list);
router.patch(
  '/:id/tip-multiplier',
  param('id').isMongoId(),
  body('tipMultiplierOverride')
    .optional({ nullable: true })
    .custom((v) => {
      if (v === null || v === undefined || v === '') return true;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0.01 || n > 100) {
        throw new Error('tipMultiplierOverride must be null or between 0.01 and 100');
      }
      return true;
    }),
  validate,
  employeeController.patchTipMultiplier,
);
router.get('/:id', param('id').isMongoId(), validate, employeeController.getOne);

module.exports = router;
