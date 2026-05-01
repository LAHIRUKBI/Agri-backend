const express = require('express');
const router = express.Router();
const protect = require('../middlewares/authMiddleware');
const adminProtect = require('../middlewares/adminMiddleware');
const {
  runQuickImageAssessment,
  createSensorRequest,
  getMyHistory,
  getMyRequests,
  getAdminRequests,
  approveRequest,
  rejectRequest,
  completeRequest,
  getRecordById,
  deleteRecordById,
  clearMyHistory
} = require('../controllers/soilHealthController');

router.post('/analyze-image', protect, runQuickImageAssessment);
router.post('/requests', protect, createSensorRequest);
router.get('/history', protect, getMyHistory);
router.delete('/history', protect, clearMyHistory);
router.get('/history/:id', protect, getRecordById);
router.delete('/history/:id', protect, deleteRecordById);
router.get('/requests/my', protect, getMyRequests);

router.get('/admin/requests', protect, adminProtect, getAdminRequests);
router.patch('/admin/requests/:id/approve', protect, adminProtect, approveRequest);
router.patch('/admin/requests/:id/reject', protect, adminProtect, rejectRequest);
router.patch('/admin/requests/:id/complete', protect, adminProtect, completeRequest);

module.exports = router;
