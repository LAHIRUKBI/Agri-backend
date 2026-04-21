const express = require("express");
const router = express.Router();
const { recommendBestMarket } = require("../controllers/marketRecommendationController");

router.post("/recommend-market", recommendBestMarket);

module.exports = router;