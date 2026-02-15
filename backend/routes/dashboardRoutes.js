const express = require('express');
const dashboardController = require('../controllers/dashboardController');

const router = express.Router();
router.get('/summary', dashboardController.getSummary);

module.exports = router;
