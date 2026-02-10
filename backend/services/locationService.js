const Location = require('../models/Location');

async function getAll(options = {}) {
  const { activeOnly = true } = options;
  const query = activeOnly ? { isActive: true } : {};
  return Location.find(query).sort({ name: 1 }).lean();
}

async function getById(id) {
  return Location.findById(id).lean();
}

async function getByName(name) {
  return Location.findOne({ name: { $regex: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } }).lean();
}

async function create(data) {
  const location = new Location(data);
  return location.save();
}

async function updateById(id, data) {
  return Location.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();
}

async function removeById(id) {
  return Location.findByIdAndUpdate(id, { isActive: false }, { new: true });
}

module.exports = {
  getAll,
  getById,
  getByName,
  create,
  updateById,
  removeById,
};
