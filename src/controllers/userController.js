const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Get user by ID
exports.getUser = async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Validate that userId is provided
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if the requested user is the same as the authenticated user
    if (user._id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to access this user' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Error in getUser:', error);
    
    // Handle specific MongoDB errors
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    res.status(500).json({ message: error.message });
  }
};

// Update user
exports.updateUser = async (req, res) => {
  try {
    const userId = req.params.id;

    // Validate that userId is provided
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    // Check if the user to update is the same as the authenticated user
    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this user' });
    }

    // Fields that are allowed to be updated (Additional Contact Information removed)
    const allowedUpdates = [
      'name',
      'email',
      'phoneNumber',
      'photoURL',
      'address',
      'addressLine2',
      'city',
      'state',
      'country',
      'zipCode'
    ];

    // Filter the request body to only include allowed fields
    const updates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    // Find and update the user
    const user = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Error in updateUser:', error);
    
    // Handle specific MongoDB errors
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ message: `${field} already exists` });
    }
    
    res.status(500).json({ message: error.message });
  }
};

// Update password
exports.updatePassword = async (req, res) => {
  try {
    const userId = req.params.id;
    const { currentPassword, newPassword } = req.body;

    // Validate inputs
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required' });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Check if the user is the same as the authenticated user
    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this user' });
    }

    // Find user with password
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    user.password = hashedPassword;
    await user.save();

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error in updatePassword:', error);
    
    if (error.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid user ID format' });
    }
    
    res.status(500).json({ message: error.message });
  }
};

// Get all users (admin only)
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}).select('-password').sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      count: users.length,
      data: users
    });
  } catch (error) {
    console.error('Error in getAllUsers:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching users',
      error: error.message 
    });
  }
};

// Get only farmers (admin only)
exports.getFarmers = async (req, res) => {
  try {
    const farmers = await User.find({ role: 'farmer' })
      .select('-password')
      .sort({ createdAt: -1 });
    
    res.status(200).json({
      success: true,
      count: farmers.length,
      data: farmers
    });
  } catch (error) {
    console.error('Error in getFarmers:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching farmers',
      error: error.message 
    });
  }
};




exports.addCropToProfile = async (req, res) => {
  try {
    const userId = req.params.id;
    const { cropName, district } = req.body;

    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this user' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Store ONLY the crop reference and start date, NOT the steps
    user.activeCultivations.push({
      cropName,
      district,
      startDate: new Date()
    });

    await user.save();
    res.status(200).json({ success: true, message: 'Crop added to profile successfully!' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};



// Delete a specific crop from the user's profile
exports.deleteCropFromProfile = async (req, res) => {
  try {
    const userId = req.params.id;
    const cropId = req.params.cropId;
    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this user' });
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const initialLength = user.activeCultivations.length;
    user.activeCultivations = user.activeCultivations.filter(
      (crop) => crop._id.toString() !== cropId
    );
    if (user.activeCultivations.length === initialLength) {
      return res.status(404).json({ message: 'Crop not found in profile' });
    }
    await user.save();
    res.status(200).json({ 
      success: true, 
      message: 'Crop removed successfully!',
      data: user 
    });
  } catch (error) {
    console.error('Error deleting crop:', error);
    res.status(500).json({ message: error.message });
  }
};


// Start tracking a specific crop
exports.startCropTracking = async (req, res) => {
  try {
    const userId = req.params.id;
    const cropId = req.params.cropId;

    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to update this user' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const cropIndex = user.activeCultivations.findIndex(c => c._id.toString() === cropId);
    if (cropIndex === -1) {
      return res.status(404).json({ message: 'Crop not found in profile' });
    }

    // Update tracking status AND initialize step timers
    user.activeCultivations[cropIndex].isTracking = true;
    user.activeCultivations[cropIndex].trackingStartDate = new Date();
    user.activeCultivations[cropIndex].currentStepIndex = 0;
    user.activeCultivations[cropIndex].currentStepStartDate = new Date();

    await user.save();
    
    res.status(200).json({ 
      success: true, 
      message: 'Tracking started successfully!',
      data: user 
    });
  } catch (error) {
    console.error('Error starting crop tracking:', error);
    res.status(500).json({ message: error.message });
  }
};

// NEW: Advance to the next cultivation step early
exports.advanceCropStep = async (req, res) => {
  try {
    const userId = req.params.id;
    const cropId = req.params.cropId;

    if (userId !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const cropIndex = user.activeCultivations.findIndex(c => c._id.toString() === cropId);
    if (cropIndex === -1) {
      return res.status(404).json({ message: 'Crop not found' });
    }

    // Increment step and reset the start timer for the new step
    const currentCrop = user.activeCultivations[cropIndex];
    currentCrop.currentStepIndex = (currentCrop.currentStepIndex || 0) + 1;
    currentCrop.currentStepStartDate = new Date();

    await user.save();
    
    res.status(200).json({ 
      success: true, 
      message: 'Advanced to next stage successfully!',
      data: user 
    });
  } catch (error) {
    console.error('Error advancing crop step:', error);
    res.status(500).json({ message: error.message });
  }
};