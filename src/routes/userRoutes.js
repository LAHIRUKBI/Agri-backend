const express = require('express');
const router = express.Router();
const { getUser, updateUser, updatePassword, getFarmers, getAllUsers  } = require('../controllers/userController');
const protect = require('../middlewares/authMiddleware');
const adminProtect = require('../middlewares/adminMiddleware');

router.get('/farmers', protect, adminProtect, getFarmers);

router.get('/:id', protect, getUser);
router.put('/:id', protect, updateUser);
router.put('/:id/password', protect, updatePassword);

module.exports = router;