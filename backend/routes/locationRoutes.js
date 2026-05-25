const express = require('express');
const { param } = require('express-validator');
const locationController = require('../controllers/locationController');
const validate = require('../middlewares/validate');

const router = express.Router();

// Locations are defined in utils/constants LOCATIONS — seeded on startup via seedLocations
router.get('/', locationController.list);
router.get('/:id', param('id').isMongoId(), validate, locationController.getOne);

module.exports = router;
