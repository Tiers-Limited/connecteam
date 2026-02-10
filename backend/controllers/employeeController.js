const employeeService = require('../services/employeeService');

async function list(req, res, next) {
  try {
    const locationId = req.query.locationId;
    const employees = locationId
      ? await employeeService.getByLocation(locationId, { activeOnly: req.query.activeOnly !== 'false' })
      : await employeeService.getAll({ activeOnly: req.query.activeOnly !== 'false' });
    res.json({ success: true, data: employees });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const employee = await employeeService.getById(req.params.id);
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });
    res.json({ success: true, data: employee });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const employee = await employeeService.create(req.body);
    res.status(201).json({ success: true, data: employee });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const employee = await employeeService.updateById(req.params.id, req.body);
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });
    res.json({ success: true, data: employee });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const employee = await employeeService.removeById(req.params.id);
    if (!employee) return res.status(404).json({ success: false, error: 'Employee not found' });
    res.json({ success: true, data: employee });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, create, update, remove };
