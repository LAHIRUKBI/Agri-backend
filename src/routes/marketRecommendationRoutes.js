const express = require("express");
const router = express.Router();
const {
  getMarketOptions,
  recommendBestMarket,
} = require("../controllers/marketRecommendationController");
const {
  saveRecommendation,
  listSavedRecommendations,
  getSavedRecommendation,
  archiveSavedRecommendation,
  getRecommendationReminder,
  scheduleRecommendationReminder,
  cancelRecommendationReminder,
} = require("../controllers/savedRecommendationController");
const authMiddleware = require("../middlewares/authMiddleware");
const farmerAuthMiddleware = require("../middlewares/farmerAuthMiddleware");

router.get("/recommend-market/options", getMarketOptions);
router.post("/recommend-market", recommendBestMarket);
router.post(
  "/recommend-market/saved",
  authMiddleware,
  farmerAuthMiddleware,
  saveRecommendation
);
router.get(
  "/recommend-market/saved",
  authMiddleware,
  farmerAuthMiddleware,
  listSavedRecommendations
);
router.get(
  "/recommend-market/saved/:id",
  authMiddleware,
  farmerAuthMiddleware,
  getSavedRecommendation
);
router.get(
  "/recommend-market/saved/:id/reminder",
  authMiddleware,
  farmerAuthMiddleware,
  getRecommendationReminder
);
router.put(
  "/recommend-market/saved/:id/reminder",
  authMiddleware,
  farmerAuthMiddleware,
  scheduleRecommendationReminder
);
router.delete(
  "/recommend-market/saved/:id/reminder",
  authMiddleware,
  farmerAuthMiddleware,
  cancelRecommendationReminder
);
router.delete(
  "/recommend-market/saved/:id",
  authMiddleware,
  farmerAuthMiddleware,
  archiveSavedRecommendation
);

module.exports = router;
