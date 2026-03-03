const express = require('express');
const router = express.Router();
const {
    registerAdmin,
    loginAdmin,
    getAllAdmins,
    getAdminById,
    updateAdmin,
    deleteAdmin,
    changePassword
} = require('../controllers/adminController');

// Public routes
router.post('/register', registerAdmin);
router.post('/login', loginAdmin);

// Protected routes (you can add authentication middleware later)
router.get('/all', getAllAdmins);
router.get('/:id', getAdminById);
router.put('/:id', updateAdmin);
router.delete('/:id', deleteAdmin);
router.post('/change-password', changePassword); // This will need auth middleware

module.exports = router;