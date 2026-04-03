const ManualWorking = require('../models/ManualWorking');
const Employee = require('../models/Employee');
const Location = require('../models/Location');
const { toDateString, dateStringToAppDayStart, dateStringToUtcRange, dateRangeToUtcBounds, getAppTimezone } = require('../utils/dateUtils');

const MANUAL_TIPS_HOURS_REASON = 'Manual hours (not from Connecteam)';

/**
 * Create or update manual working entry.
 * Provide employeeId, or employeeName + locationId to find/create a local-only employee (no Connecteam link).
 */
async function createOrUpdateManualWorking(req, res) {
  try {
    let { employeeId, employeeName, locationId, date, amHours, pmHours, amTips, pmTips, reason, notes } = req.body;

    const amH = Math.max(0, Number(amHours) || 0);
    const pmH = Math.max(0, Number(pmHours) || 0);
    const amT = Math.max(0, Number(amTips) || 0);
    const pmT = Math.max(0, Number(pmTips) || 0);

    if (!locationId || !date) {
      return res.status(400).json({ error: 'Missing required fields: locationId, date' });
    }

    const reasonStr = (reason != null && String(reason).trim() !== '')
      ? String(reason).trim()
      : MANUAL_TIPS_HOURS_REASON;

    if (!employeeId) {
      const trimmedName = employeeName != null ? String(employeeName).trim() : '';
      if (!trimmedName) {
        return res.status(400).json({ error: 'Provide employeeId or employeeName' });
      }
      let employee = await Employee.findOne({
        locationId,
        name: trimmedName,
        $or: [
          { connecteamsUserId: { $exists: false } },
          { connecteamsUserId: null },
          { connecteamsUserId: '' },
        ],
      });
      if (!employee) {
        employee = await Employee.create({
          name: trimmedName,
          locationId,
          isActive: true,
        });
      }
      employeeId = employee._id;
    }

    if (amH < 0 || pmH < 0 || amT < 0 || pmT < 0) {
      return res.status(400).json({ error: 'Hours and tips must be non-negative' });
    }

    const dateStr = String(date).trim().slice(0, 10);
    const tz = getAppTimezone();
    const { startMs, endMs } = dateStringToUtcRange(dateStr, tz);
    const dayStart = new Date(startMs);

    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const location = await Location.findById(locationId);
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const set = {
      amHours: amH,
      pmHours: pmH,
      amTips: amT,
      pmTips: pmT,
      reason: reasonStr,
      notes: notes || '',
      date: dayStart,
    };

    const existing = await ManualWorking.findOne({
      employeeId,
      locationId,
      date: { $gte: new Date(startMs), $lte: new Date(endMs) },
    });

    let manualWorking;
    if (existing) {
      manualWorking = await ManualWorking.findByIdAndUpdate(existing._id, { $set: set }, { new: true })
        .populate('employeeId', 'name')
        .populate('locationId', 'name');
    } else {
      manualWorking = await ManualWorking.create({
        employeeId,
        locationId,
        ...set,
      });
      manualWorking = await ManualWorking.findById(manualWorking._id)
        .populate('employeeId', 'name')
        .populate('locationId', 'name');
    }

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

    const { startMs, endMs } = dateRangeToUtcBounds(
      String(startDate).trim().slice(0, 10),
      String(endDate).trim().slice(0, 10),
      getAppTimezone(),
    );

    const entries = await ManualWorking.find({
      locationId,
      date: { $gte: new Date(startMs), $lte: new Date(endMs) },
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

    const dateStr = String(date).trim().slice(0, 10);
    const { startMs, endMs } = dateStringToUtcRange(dateStr, getAppTimezone());

    const entries = await ManualWorking.find({
      locationId,
      date: { $gte: new Date(startMs), $lte: new Date(endMs) },
    })
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

    const { startMs, endMs } = dateRangeToUtcBounds(
      String(startDate).trim().slice(0, 10),
      String(endDate).trim().slice(0, 10),
      getAppTimezone(),
    );

    const entries = await ManualWorking.find({
      employeeId,
      date: { $gte: new Date(startMs), $lte: new Date(endMs) },
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
