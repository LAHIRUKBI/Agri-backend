
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const connectDB = require('./src/config/database');

// Import routes only once
const authRoutes = require('./src/routes/authRoutes');
const userRoutes = require('./src/routes/userRoutes');
const adminRoutes = require('./src/routes/adminRoutes');
const rotationRoutes = require('./src/routes/rotationRoutes');
const guidanceRoutes = require('./src/routes/guidanceRoutes');
const nutrientRoutes = require('./src/routes/nutrientRoutes');
const soilHealthRoutes = require('./src/routes/soilHealthRoutes');
const predictionRoutes = require('./src/routes/predictionRoutes');
const marketRecommendationRoutes = require('./src/routes/marketRecommendationRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

console.log(
    `JWT_SECRET: ${process.env.JWT_SECRET ? '✓ Configured' : '✗ Missing'}`
);

// Connect to database
connectDB();

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/rotation', rotationRoutes);
app.use('/api/guidance', guidanceRoutes);
app.use('/api/nutrients', nutrientRoutes);
app.use('/api/soil-health', soilHealthRoutes);
app.use('/api', predictionRoutes);
app.use('/api', marketRecommendationRoutes);
app.use('/api/notifications', notificationRoutes);

// 404 handler - Must come after all routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Cannot ${req.method} ${req.originalUrl} - Route not found`
    });
});

// Error handling middleware - Must come after all routes
app.use((err, req, res, next) => {
    console.error('❌ Error:', err.stack);

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && {
            stack: err.stack
        })
    });
});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
});
