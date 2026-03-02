const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { 
    type: String, 
    sparse: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  phoneNumber: {
    type: String,
    sparse: true,
    unique: true,
    trim: true
  },
  password: { type: String, required: true },
  firebaseUid: { 
    type: String,
    sparse: true,
    unique: true
  },
  photoURL: { 
    type: String 
  },
  role: { 
    type: String, 
    enum: ['farmer', 'admin'], 
    default: 'farmer' 
  },
  farmLocation: { type: String }
}, { timestamps: true });

UserSchema.pre('validate', function(next) {
  if (!this.email && !this.phoneNumber) {
    next(new Error('Either email or phone number is required'));
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);