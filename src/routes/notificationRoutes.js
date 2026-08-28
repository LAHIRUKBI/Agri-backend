const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const farmerAuthMiddleware = require("../middlewares/farmerAuthMiddleware");
const {
  listNotifications,
  markNotificationRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.get("/", authMiddleware, farmerAuthMiddleware, listNotifications);
router.patch(
  "/:id/read",
  authMiddleware,
  farmerAuthMiddleware,
  markNotificationRead
);

module.exports = router;
