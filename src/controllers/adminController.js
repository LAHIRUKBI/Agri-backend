const Admin = require('../models/adminModel');
const jwt = require('jsonwebtoken');

// Generate JWT Token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE || '30d'
    });
};

// @desc    Register a new admin
// @route   POST /api/admin/register
// @access  Public
const registerAdmin = async (req, res) => {
    try {
        const { name, email, phoneNumber, password } = req.body;

        // Validate required fields
        if (!name || !email || !phoneNumber || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields: name, email, phone number, and password'
            });
        }

        // Validate password length
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long'
            });
        }

        // Check if admin already exists with same email
        const existingAdminByEmail = await Admin.findOne({ email });
        if (existingAdminByEmail) {
            return res.status(400).json({
                success: false,
                message: 'Admin with this email already exists'
            });
        }

        // Check if admin already exists with same phone number
        const existingAdminByPhone = await Admin.findOne({ phoneNumber });
        if (existingAdminByPhone) {
            return res.status(400).json({
                success: false,
                message: 'Admin with this phone number already exists'
            });
        }

        // Create new admin with role set to 'admin' automatically
        const admin = await Admin.create({
            name,
            email,
            phoneNumber,
            password,
            role: 'admin' // This is automatically set by the schema default
        });

        // Generate token
        const token = generateToken(admin._id);

        // Return success response without sensitive data
        res.status(201).json({
            success: true,
            message: 'Admin registered successfully',
            token,
            data: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                phoneNumber: admin.phoneNumber,
                role: admin.role,
                createdAt: admin.createdAt
            }
        });

    } catch (error) {
        console.error('Admin registration error:', error);
        
        // Handle mongoose validation errors
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: messages
            });
        }

        // Handle duplicate key error
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `Admin with this ${field} already exists`
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error registering admin',
            error: error.message
        });
    }
};

// @desc    Login admin
// @route   POST /api/admin/login
// @access  Public
const loginAdmin = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password'
            });
        }

        // Find admin by email and include password field
        const admin = await Admin.findOne({ email }).select('+password');

        // Check if admin exists
        if (!admin) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Check if admin is active
        if (!admin.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Your account has been deactivated. Please contact super admin.'
            });
        }

        // Compare password
        const isPasswordValid = await admin.comparePassword(password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid email or password'
            });
        }

        // Update last login
        admin.lastLogin = new Date();
        await admin.save({ validateBeforeSave: false });

        // Generate token
        const token = generateToken(admin._id);

        res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            data: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                phoneNumber: admin.phoneNumber,
                role: admin.role
            }
        });

    } catch (error) {
        console.error('Admin login error:', error);
        res.status(500).json({
            success: false,
            message: 'Error logging in',
            error: error.message
        });
    }
};

// @desc    Get all admins
// @route   GET /api/admin/all
// @access  Private/Admin
const getAllAdmins = async (req, res) => {
    try {
        const admins = await Admin.find({})
            .select('-__v')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: admins.length,
            data: admins
        });
    } catch (error) {
        console.error('Error fetching admins:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching admins',
            error: error.message
        });
    }
};

// @desc    Get single admin by ID
// @route   GET /api/admin/:id
// @access  Private/Admin
const getAdminById = async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id).select('-__v');

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        res.status(200).json({
            success: true,
            data: admin
        });
    } catch (error) {
        console.error('Error fetching admin:', error);
        
        // Handle invalid ObjectId
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid admin ID format'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error fetching admin',
            error: error.message
        });
    }
};

// @desc    Update admin
// @route   PUT /api/admin/:id
// @access  Private/Admin
const updateAdmin = async (req, res) => {
    try {
        const { name, email, phoneNumber, password, isActive } = req.body;
        
        // Create update object
        const updateData = {
            name,
            email,
            phoneNumber,
            isActive
        };

        // Only update password if provided
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'Password must be at least 6 characters long'
                });
            }
            updateData.password = password;
            updateData.passwordChangedAt = new Date();
        }

        // Find admin and update
        const admin = await Admin.findByIdAndUpdate(
            req.params.id,
            updateData,
            {
                new: true, // Return updated document
                runValidators: true // Run schema validators
            }
        ).select('-__v');

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Admin updated successfully',
            data: admin
        });
    } catch (error) {
        console.error('Error updating admin:', error);
        
        // Handle duplicate key error
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `Admin with this ${field} already exists`
            });
        }

        // Handle validation errors
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(err => err.message);
            return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: messages
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error updating admin',
            error: error.message
        });
    }
};

// @desc    Delete admin
// @route   DELETE /api/admin/:id
// @access  Private/Admin
const deleteAdmin = async (req, res) => {
    try {
        const admin = await Admin.findByIdAndDelete(req.params.id);

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Admin deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting admin:', error);
        
        // Handle invalid ObjectId
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid admin ID format'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error deleting admin',
            error: error.message
        });
    }
};

// @desc    Change password
// @route   POST /api/admin/change-password
// @access  Private/Admin
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const adminId = req.user.id; // Assuming you have auth middleware that sets req.user

        // Validate input
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Please provide current password and new password'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters long'
            });
        }

        // Get admin with password field
        const admin = await Admin.findById(adminId).select('+password');

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        // Verify current password
        const isPasswordValid = await admin.comparePassword(currentPassword);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Update password
        admin.password = newPassword;
        admin.passwordChangedAt = new Date();
        await admin.save();

        res.status(200).json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({
            success: false,
            message: 'Error changing password',
            error: error.message
        });
    }
};

module.exports = {
    registerAdmin,
    loginAdmin,
    getAllAdmins,
    getAdminById,
    updateAdmin,
    deleteAdmin,
    changePassword
};