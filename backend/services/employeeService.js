const Employee = require('../models/Employee');

async function findOrCreateByConnecteams(connecteamsUserId, locationId, name) {
  let employee = await Employee.findOne({
    connecteamsUserId: String(connecteamsUserId),
    locationId,
  });
  if (employee) return employee;
  employee = new Employee({
    name: name || 'Employee',
    locationId,
    connecteamsUserId: String(connecteamsUserId),
    isActive: true,
  });
  await employee.save();
  return employee;
}

async function getByLocation(locationId, options = {}) {
  const { activeOnly = true } = options;
  const query = { locationId };
  if (activeOnly) query.isActive = true;
  return Employee.find(query).sort({ name: 1 }).populate('locationId', 'name').lean();
}

async function getAll(options = {}) {
  const { activeOnly = true } = options;
  const query = activeOnly ? { isActive: true } : {};
  return Employee.find(query).sort({ name: 1 }).populate('locationId', 'name').lean();
}

async function getById(id) {
  return Employee.findById(id).populate('locationId', 'name').lean();
}

async function create(data) {
  const employee = new Employee(data);
  return employee.save();
}

async function updateById(id, data) {
  return Employee.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();
}

async function removeById(id) {
  return Employee.findByIdAndUpdate(id, { isActive: false }, { new: true });
}

/**
 * Persist tip multiplier override on the employee (used by daily tips calculation).
 * Pass null to clear and use job-title default again.
 */
async function setTipMultiplierOverride(id, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return Employee.findByIdAndUpdate(
      id,
      { $unset: { tipMultiplierOverride: 1 } },
      { new: true },
    )
      .populate('locationId', 'name')
      .lean();
  }
  const v = Number(rawValue);
  if (!Number.isFinite(v) || v < 0.01 || v > 100) {
    const err = new Error('tipMultiplierOverride must be between 0.01 and 100');
    err.status = 400;
    throw err;
  }
  return Employee.findByIdAndUpdate(
    id,
    { $set: { tipMultiplierOverride: v } },
    { new: true },
  )
    .populate('locationId', 'name')
    .lean();
}

module.exports = {
  findOrCreateByConnecteams,
  getByLocation,
  getAll,
  getById,
  create,
  updateById,
  removeById,
  setTipMultiplierOverride,
};
