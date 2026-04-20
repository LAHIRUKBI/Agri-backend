const express = require("express");
const router = express.Router();
const { predictPriceDirection } = require("../controllers/predictionController");

router.post("/predict", predictPriceDirection);

module.exports = router;