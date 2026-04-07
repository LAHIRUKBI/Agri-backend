// backend/src/routes/guidanceRoutes.js
const express = require('express');
const router = express.Router();
const { getRecommendations, getCropSteps } = require('../controllers/guidanceController.js');

router.post('/recommend', getRecommendations);
router.post('/steps', getCropSteps);

module.exports = router;