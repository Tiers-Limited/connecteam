const express = require('express');
const { param } = require('express-validator');
const timeEntryController = require('../controllers/timeEntryController');
const validate = require('../middlewares/validate');

const router = express.Router();

// Time entries come from Connecteams sync only — read-only API
router.get(
  '/:locationId/range',
  param('locationId').isMongoId(),
  validate,
  timeEntryController.getByLocationDateRange
);
router.get(
  '/:locationId/:date',
  param('locationId').isMongoId(),
  param('date').isISO8601(),
  validate,
  timeEntryController.getByLocationAndDate
);

module.exports = router;
