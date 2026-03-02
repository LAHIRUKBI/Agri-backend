const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const connectDB = require('./src/config/database');
const authRoutes = require('./src/routes/authRoutes');
// const rotationRoutes = require('./src/routes/rotationRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log(`✅ JWT_SECRET: ${process.env.JWT_SECRET ? '✓ Run' : '✗ Missing'}`);

// Connect to database using the imported function
connectDB();

// Routes
app.use('/api/auth', authRoutes);
// app.use('/api/rotation', rotationRoutes);


// 404 handler - This must come AFTER all other routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Cannot ${req.method} ${req.originalUrl} - Route not found`
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
});