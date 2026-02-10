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

module.exports = {
  findOrCreateByConnecteams,
  getByLocation,
  getAll,
  getById,
  create,
  updateById,
  removeById,
};
