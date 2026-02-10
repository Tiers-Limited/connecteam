const ManualWorking = require('../models/ManualWorking');
const { toDateString } = require('../utils/dateUtils');

/**
 * Create or update a manual working entry
 * @param {string} employeeId - Employee ID
 * @param {string} locationId - Location ID
 * @param {string} date - Date (YYYY-MM-DD or Date object)
 * @param {number} amHours - AM hours worked
 * @param {number} pmHours - PM hours worked
 * @param {number} amTips - AM tips
 * @param {number} pmTips - PM tips
 * @param {string} reason - Reason for manual entry (e.g., "No Clock In", "Adjustment", etc.)
 * @param {string} notes - Additional notes
 * @returns {Promise<Object>} Updated manual working entry
 */
async function upsertManualWorking(employeeId, locationId, date, amHours, pmHours, amTips, pmTips, reason, notes = '') {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  return ManualWorking.findOneAndUpdate(
    { employeeId, locationId, date: dateObj },
    {
      $set: {
        amHours,
        pmHours,
        amTips,
        pmTips,
        reason,
        notes,
      },
    },
    { new: true, upsert: true }
  )
    .populate('employeeId', 'name')
    .populate('locationId', 'name');
}

/**
 * Get manual working entry for a specific employee, location, and date
 */
async function getManualWorking(employeeId, locationId, date) {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  return ManualWorking.findOne({ employeeId, locationId, date: dateObj })
    .populate('employeeId', 'name')
    .populate('locationId', 'name');
}

/**
 * Get all manual working entries for a location on a given date
 */
async function getManualWorkingByLocationDate(locationId, date) {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  return ManualWorking.find({ locationId, date: dateObj })
    .populate('employeeId', 'name')
    .sort({ employeeId: 1 });
}

/**
 * Get all manual working entries for a location within a date range
 */
async function getManualWorkingByLocationDateRange(locationId, startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  return ManualWorking.find({
    locationId,
    date: { $gte: start, $lte: end },
  })
    .populate('employeeId', 'name')
    .sort({ date: 1, employeeId: 1 });
}

/**
 * Get all manual working entries for an employee within a date range
 */
async function getEmployeeManualWorkingByDateRange(employeeId, startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  return ManualWorking.find({
    employeeId,
    date: { $gte: start, $lte: end },
  })
    .populate('locationId', 'name')
    .sort({ date: 1 });
}

/**
 * Delete a manual working entry
 */
async function deleteManualWorking(employeeId, locationId, date) {
  const dateObj = new Date(date);
  dateObj.setHours(0, 0, 0, 0);

  return ManualWorking.findOneAndDelete({
    employeeId,
    locationId,
    date: dateObj,
  });
}

/**
 * Get total manual tips for an employee at a location for a date range
 */
async function getTotalManualTips(employeeId, locationId, startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const entries = await ManualWorking.find({
    employeeId,
    locationId,
    date: { $gte: start, $lte: end },
  });

  const total = entries.reduce((sum, entry) => sum + entry.amTips + entry.pmTips, 0);
  return Math.round(total * 100) / 100;
}

/**
 * Get total manual hours for an employee at a location for a date range
 */
async function getTotalManualHours(employeeId, locationId, startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const entries = await ManualWorking.find({
    employeeId,
    locationId,
    date: { $gte: start, $lte: end },
  });

  const total = entries.reduce((sum, entry) => sum + entry.amHours + entry.pmHours, 0);
  return Math.round(total * 100) / 100;
}

module.exports = {
  upsertManualWorking,
  getManualWorking,
  getManualWorkingByLocationDate,
  getManualWorkingByLocationDateRange,
  getEmployeeManualWorkingByDateRange,
  deleteManualWorking,
  getTotalManualTips,
  getTotalManualHours,
};
