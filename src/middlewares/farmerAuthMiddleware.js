const mongoose = require("mongoose");
const User = require("../models/User");

const denyFarmerAccess = (res) =>
  res.status(403).json({
    success: false,
    message: "Farmer access required",
  });

module.exports = async (req, res, next) => {
  const userId = req.user?.id;

  if (!userId || !mongoose.isObjectIdOrHexString(userId)) {
    return denyFarmerAccess(res);
  }

  try {
    const farmer = await User.exists({
      _id: userId,
      role: "farmer",
    });

    if (!farmer) {
      return denyFarmerAccess(res);
    }

    return next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to verify farmer access",
    });
  }
};
