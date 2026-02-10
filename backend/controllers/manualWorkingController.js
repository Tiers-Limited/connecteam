const ManualWorking = require('../models/ManualWorking');
const Employee = require('../models/Employee');
const Location = require('../models/Location');
const { toDateString } = require('../utils/dateUtils');

/**
 * Create or update manual working entry
 */
async function createOrUpdateManualWorking(req, res) {
  try {
    const { employeeId, locationId, date, amHours, pmHours, amTips, pmTips, reason, notes } = req.body;

    // Validation
    if (!employeeId || !locationId || !date || !reason) {
      return res.status(400).json({ error: 'Missing required fields: employeeId, locationId, date, reason' });
    }

    if (amHours < 0 || pmHours < 0 || amTips < 0 || pmTips < 0) {
      return res.status(400).json({ error: 'Hours and tips must be non-negative' });
    }

    const dateObj = new Date(date);
    dateObj.setHours(0, 0, 0, 0);

    // Verify employee exists
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Verify location exists
    const location = await Location.findById(locationId);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const manualWorking = await ManualWorking.findOneAndUpdate(
      { employeeId, locationId, date: dateObj },
      {
        $set: {
          amHours,
          pmHours,
          amTips,
          pmTips,
          reason,
          notes: notes || '',
        },
      },
      { new: true, upsert: true }
    )
      .populate('employeeId', 'name')
      .populate('locationId', 'name');

    return res.status(200).json({ message: 'Manual working entry saved', data: manualWorking });
  } catch (error) {
    console.error('Error in createOrUpdateManualWorking:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Get manual working entries for a date range
 */
async function getManualWorkingByDateRange(req, res) {
  try {
    const { locationId, startDate, endDate } = req.query;

    if (!locationId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required query params: locationId, startDate, endDate' });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const entries = await ManualWorking.find({
      locationId,
      date: { $gte: start, $lte: end },
    })
      .populate('employeeId', 'name')
      .sort({ date: 1, employeeId: 1 });

    return res.status(200).json({ data: entries });
  } catch (error) {
    console.error('Error in getManualWorkingByDateRange:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Get manual working for a specific date and location
 */
async function getManualWorkingByDate(req, res) {
  try {
    const { locationId, date } = req.query;

    if (!locationId || !date) {
      return res.status(400).json({ error: 'Missing required query params: locationId, date' });
    }

    const dateObj = new Date(date);
    dateObj.setHours(0, 0, 0, 0);

    const entries = await ManualWorking.find({ locationId, date: dateObj })
      .populate('employeeId', 'name')
      .sort({ employeeId: 1 });

    return res.status(200).json({ data: entries });
  } catch (error) {
    console.error('Error in getManualWorkingByDate:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Delete a manual working entry
 */
async function deleteManualWorking(req, res) {
  try {
    const { manualWorkingId } = req.params;

    if (!manualWorkingId) {
      return res.status(400).json({ error: 'Missing manualWorkingId' });
    }

    const result = await ManualWorking.findByIdAndDelete(manualWorkingId);

    if (!result) {
      return res.status(404).json({ error: 'Manual working entry not found' });
    }

    return res.status(200).json({ message: 'Manual working entry deleted', data: result });
  } catch (error) {
    console.error('Error in deleteManualWorking:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Get all manual working entries for an employee in a date range
 */
async function getEmployeeManualWorking(req, res) {
  try {
    const { employeeId, startDate, endDate } = req.query;

    if (!employeeId || !startDate || !endDate) {
      return res.status(400).json({ error: 'Missing required query params: employeeId, startDate, endDate' });
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const entries = await ManualWorking.find({
      employeeId,
      date: { $gte: start, $lte: end },
    })
      .populate('locationId', 'name')
      .sort({ date: 1 });

    return res.status(200).json({ data: entries });
  } catch (error) {
    console.error('Error in getEmployeeManualWorking:', error);
    return res.status(500).json({ error: error.message });
  }
}

module.exports = {
  createOrUpdateManualWorking,
  getManualWorkingByDateRange,
  getManualWorkingByDate,
  deleteManualWorking,
  getEmployeeManualWorking,
};
