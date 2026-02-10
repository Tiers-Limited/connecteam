const timeEntryService = require('../services/timeEntryService');

async function getByLocationAndDate(req, res, next) {
  try {
    const { locationId, date } = req.params;
    const entries = await timeEntryService.getByLocationAndDate(locationId, date);
    res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
}

async function getByLocationDateRange(req, res, next) {
  try {
    const { locationId } = req.params;
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ success: false, error: 'startDate and endDate required' });
    const entries = await timeEntryService.getByLocationDateRange(locationId, startDate, endDate);
    res.json({ success: true, data: entries });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const entry = await timeEntryService.create(req.body);
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const entry = await timeEntryService.updateById(req.params.id, req.body);
    if (!entry) return res.status(404).json({ success: false, error: 'Time entry not found' });
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const entry = await timeEntryService.removeById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, error: 'Time entry not found' });
    res.json({ success: true, data: entry });
  } catch (err) {
    next(err);
  }
}

module.exports = { getByLocationAndDate, getByLocationDateRange, create, update, remove };
