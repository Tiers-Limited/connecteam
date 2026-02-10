const express = require('express');
const { param } = require('express-validator');
const employeeController = require('../controllers/employeeController');
const validate = require('../middlewares/validate');

const router = express.Router();

// Employees come from Connecteams sync only — no manual create/update/delete
router.get('/', employeeController.list);
router.get('/:id', param('id').isMongoId(), validate, employeeController.getOne);

module.exports = router;
