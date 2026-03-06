// backend/src/middlewares/adminMiddleware.js
const Admin = require('../models/adminModel');

module.exports = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Invalid authentication token' });
    }

    const admin = await Admin.findById(req.user.id);

    if (!admin) {
      return res.status(401).json({ message: 'Admin not found in database' });
    }

    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Admin privileges required.'
      });
    }

    // Add admin info to request
    req.admin = admin;
    req.user.role = 'admin';
    next();

  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};