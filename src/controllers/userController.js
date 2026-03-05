const User = require('../models/User');

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

    // Fields that are allowed to be updated (Farm Information removed)
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
      'zipCode',
      'alternatePhone',
      'emergencyContact',
      'emergencyContactName',
      'website',
      'socialMedia'
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
    
    res.status(500).json({ message: error.message });
  }
};