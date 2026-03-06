const express = require('express');
const router = express.Router();
const { getUser, updateUser, updatePassword } = require('../controllers/userController');
const protect = require('../middlewares/authMiddleware');

router.get('/:id', protect, getUser);
router.put('/:id', protect, updateUser);
router.put('/:id/password', protect, updatePassword);

module.exports = router;