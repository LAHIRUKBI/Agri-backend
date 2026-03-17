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
  address: { type: String },
  addressLine2: { type: String },
  city: { type: String },
  state: { type: String },
  country: { type: String },
  zipCode: { type: String },
  
  // UPDATED: Added detailed tracking fields for the countdown
  activeCultivations: [{
    cropName: { type: String, required: true },
    district: { type: String, required: true },
    startDate: { type: Date, default: Date.now },
    isTracking: { type: Boolean, default: false },
    trackingStartDate: { type: Date },
    currentStepIndex: { type: Number, default: 0 },
    currentStepStartDate: { type: Date }
  }]
}, { timestamps: true });

UserSchema.pre('validate', function(next) {
  if (!this.email && !this.phoneNumber) {
    next(new Error('Either email or phone number is required'));
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);