// backend/src/routes/guidanceRoutes.js
const express = require('express');
const router = express.Router();
const { getRecommendations } = require('../controllers/guidanceController.js');

router.post('/recommend', getRecommendations);

module.exports = router;