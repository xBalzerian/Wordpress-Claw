require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Initialize database
const db = require('./database/db');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const businessProfileRoutes = require('./routes/business-profile');
const connectionsRoutes = require('./routes/connections');
const articlesRoutes = require('./routes/articles');
const clawbotRoutes = require('./routes/clawbot');
const spreadsheetRoutes = require('./routes/spreadsheet');
const spreadsheetSimpleRoutes = require('./routes/spreadsheet-simple');

const app = express();
const PORT = process.env.PORT || 3000;

// Disable helmet completely to avoid CSP issues
// app.use(helmet({
//     contentSecurityPolicy: false,
//     crossOriginEmbedderPolicy: false
// }));

// Set permissive CSP headers
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline'; img-src * data: blob:; connect-src *;");
    res.setHeader('X-Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval';");
    res.setHeader('X-WebKit-CSP', "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval';");
    next();
});

// CORS configuration
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL || 'https://wordpressclaw.com'
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
    credentials: true
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    message: {
        success: false,
        error: 'Too many requests, please try again later.'
    }
});
app.use('/api/', limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
        success: false,
        error: 'Too many authentication attempts, please try again later.'
    }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging (development only)
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '4.0.0-no-javascript'
    });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/business-profile', businessProfileRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/articles', articlesRoutes);
app.use('/api/clawbot', clawbotRoutes);
app.use('/api/spreadsheet', spreadsheetRoutes);
app.use('/api/spreadsheet-simple', spreadsheetSimpleRoutes);

// Serve spreadsheet-simple.html from the API route (server-rendered, no JS)
app.use('/dashboard/spreadsheet-simple.html', spreadsheetSimpleRoutes);

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, 'frontend')));

// Serve dashboard routes (catch-all for other dashboard pages)
app.get('/dashboard/*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/dashboard/index.html'));
});

// Catch-all for SPA routing (frontend handles routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
            ? 'An unexpected error occurred' 
            : err.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   🦞 WordPress Claw Server                             ║
║                                                        ║
║   Status: Running                                      ║
║   Port: ${PORT}                                          ║
║   Environment: ${process.env.NODE_ENV || 'development'}                          ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;