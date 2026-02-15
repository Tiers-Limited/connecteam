const dashboardService = require('../services/dashboardService');

async function getSummary(req, res, next) {
  try {
    const data = await dashboardService.getDashboardSummary();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

module.exports = { getSummary };
