const express = require('express');
const router = express.Router();
const {
  createOrUpdateManualWorking,
  getManualWorkingByDateRange,
  getManualWorkingByDate,
  deleteManualWorking,
  getEmployeeManualWorking,
} = require('../controllers/manualWorkingController');

/**
 * POST /manual-working
 * Create or update a manual working entry
 */
router.post('/', createOrUpdateManualWorking);

/**
 * GET /manual-working/date-range
 * Get manual working entries for a date range
 * Query params: locationId, startDate, endDate
 */
router.get('/date-range', getManualWorkingByDateRange);

/**
 * GET /manual-working/by-date
 * Get manual working entries for a specific date
 * Query params: locationId, date
 */
router.get('/by-date', getManualWorkingByDate);

/**
 * GET /manual-working/employee
 * Get all manual working entries for an employee in a date range
 * Query params: employeeId, startDate, endDate
 */
router.get('/employee', getEmployeeManualWorking);

/**
 * DELETE /manual-working/:manualWorkingId
 * Delete a manual working entry
 */
router.delete('/:manualWorkingId', deleteManualWorking);

module.exports = router;
