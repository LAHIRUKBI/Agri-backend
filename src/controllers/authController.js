const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Helper function to validate phone number format
const isValidPhoneNumber = (phone) => {
  const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,4}[-\s\.]?[0-9]{4,9}$/;
  return phoneRegex.test(phone);
};

// Helper function to validate email format
const isValidEmail = (email) => {
  const emailRegex = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  return emailRegex.test(email);
};

// signup function
exports.signup = async (req, res) => {
  try {
    const { name, email, phoneNumber, password, firebaseUid, photoURL } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Name is required' });
    }

    if (!email && !phoneNumber) {
      return res.status(400).json({ message: 'Either email or phone number is required' });
    }

    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }

    const query = [];
    if (email) query.push({ email });
    if (phoneNumber) query.push({ phoneNumber });

    const existingUser = await User.findOne({ $or: query });
    if (existingUser) {
      return res.status(400).json({ message: 'User already registered' });
    }

    let finalPassword;

    if (firebaseUid) {
      // Google signup
      finalPassword = password;
    } else {
      // Normal signup
      finalPassword = await bcrypt.hash(password, 10);
    }

    const newUser = new User({
      name,
      email: email || undefined,
      phoneNumber: phoneNumber || undefined,
      password: finalPassword,
      firebaseUid: firebaseUid || undefined,
      photoURL: photoURL || undefined
    });

    await newUser.save();

    const token = jwt.sign(
      { id: newUser._id },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        phoneNumber: newUser.phoneNumber,
        photoURL: newUser.photoURL,
        role: newUser.role
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// signin function
exports.signin = async (req, res) => {
  try {
    const { identifier, password, firebaseUid } = req.body;

    if (!identifier) {
      return res.status(400).json({
        message: 'Please provide email or phone number'
      });
    }

    // Determine if identifier is email or phone number
    const isEmail = isValidEmail(identifier);

    // Build query based on identifier type
    const query = isEmail
      ? { email: identifier.toLowerCase() }
      : { phoneNumber: identifier };

    // Find user
    const user = await User.findOne(query);
    if (!user) {
      return res.status(404).json({
        message: isEmail ? 'Email not found' : 'Phone number not found'
      });
    }

    // Check if this is a Google sign-in attempt
    if (firebaseUid) {
      // For Google sign-in, verify that the firebaseUid matches
      if (user.firebaseUid !== firebaseUid) {
        return res.status(400).json({ message: 'Invalid Google authentication' });
      }
      // Skip password check for Google sign-in
    } else {
      // For regular sign-in, first check if this is a Google-authenticated user
      if (user.firebaseUid) {
        // This user signed up with Google and doesn't have a regular password
        return res.status(400).json({
          message: 'This account uses Google Sign-In. Please use the Google Sign-In button.'
        });
      }

      // For regular sign-in, verify password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }
    }

    // Generate JWT
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
        photoURL: user.photoURL
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};