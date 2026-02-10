const express = require('express');
const { param } = require('express-validator');
const locationController = require('../controllers/locationController');
const validate = require('../middlewares/validate');

const router = express.Router();

// Locations are the 4 fixed (Oranjestad, Casa del Mar, The Cove, Drive Thru) — seeded on startup, no manual add/edit
router.get('/', locationController.list);
router.get('/:id', param('id').isMongoId(), validate, locationController.getOne);

module.exports = router;
