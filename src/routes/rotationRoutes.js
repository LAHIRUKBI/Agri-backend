// backend/src/routes/rotationRoutes.js
const express = require('express');
const router = express.Router();
const { getRotationPlan } = require('../controllers/rotationController');
const { getAllCrops } = require('../controllers/cropController');
const authMiddleware = require('../middlewares/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

router.post('/plan', getRotationPlan);
router.get('/crops', getAllCrops);


module.exports = router;