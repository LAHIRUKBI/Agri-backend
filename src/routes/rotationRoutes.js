// backend/src/routes/rotationRoutes.js
const express = require('express');
const router = express.Router();
const { getRotationPlan, getSavedPlans, deletePlan, getPendingRules, updateRuleStatus, fetchNewRules } = require('../controllers/rotationController');
const { getAllCrops } = require('../controllers/cropController');
const authMiddleware = require('../middlewares/authMiddleware');

// All routes require authentication
router.use(authMiddleware);

router.post('/plan', getRotationPlan);
router.get('/crops', getAllCrops);
router.get('/history', getSavedPlans);
router.delete('/history/:id', deletePlan);
router.get('/pending', getPendingRules);
router.put('/:id/status', updateRuleStatus);
router.post('/fetch-rules', fetchNewRules);

module.exports = router;