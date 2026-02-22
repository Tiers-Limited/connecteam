const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const Supervisor = require('../models/Supervisor');
const { jwtSecret } = require('../config/env');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    const role = decoded.role || 'admin';

    if (role === 'supervisor') {
      const supervisor = await Supervisor.findById(decoded.userId).select('-password');
      if (!supervisor) {
        return res.status(401).json({ message: 'User not found' });
      }
      req.user = supervisor;
    } else {
      const admin = await Admin.findById(decoded.userId).select('-password');
      if (!admin) {
        return res.status(401).json({ message: 'User not found' });
      }
      req.user = admin;
    }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

module.exports = { authMiddleware, requireAdmin };
