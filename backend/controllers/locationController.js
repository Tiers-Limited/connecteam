const locationService = require('../services/locationService');

async function list(req, res, next) {
  try {
    const locations = await locationService.getAll(req.query.activeOnly !== 'false');
    res.json({ success: true, data: locations });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const location = await locationService.getById(req.params.id);
    if (!location) return res.status(404).json({ success: false, error: 'Location not found' });
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const location = await locationService.create(req.body);
    res.status(201).json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const location = await locationService.updateById(req.params.id, req.body);
    if (!location) return res.status(404).json({ success: false, error: 'Location not found' });
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const location = await locationService.removeById(req.params.id);
    if (!location) return res.status(404).json({ success: false, error: 'Location not found' });
    res.json({ success: true, data: location });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, update, remove };
