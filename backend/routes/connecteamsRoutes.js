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

module.exports = router;
