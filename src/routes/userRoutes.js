const express = require('express');
const router = express.Router();
const { getUser, updateUser, updatePassword, getFarmers, getAllUsers, addCropToProfile, deleteCropFromProfile, startCropTracking, advanceCropStep  } = require('../controllers/userController');
const protect = require('../middlewares/authMiddleware');
const adminProtect = require('../middlewares/adminMiddleware');

router.get('/farmers', protect, adminProtect, getFarmers);

router.get('/:id', protect, getUser);
router.put('/:id', protect, updateUser);
router.put('/:id/password', protect, updatePassword);
router.put('/:id/add-crop', protect, addCropToProfile);
router.delete('/:id/crop/:cropId', protect, deleteCropFromProfile);
router.put('/:id/crop/:cropId/start', protect, startCropTracking);
router.put('/:id/crop/:cropId/advance', protect, advanceCropStep);

module.exports = router;