const express = require('express');
const bcrypt = require('bcryptjs');
const validator = require('validator');
const db = require('../database/db');
const { generateToken } = require('../middleware/auth');

const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        // Validation
        if (!email || !password || !name) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, and name are required'
            });
        }

        if (!validator.isEmail(email)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters'
            });
        }

        if (name.length < 2 || name.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Name must be between 2 and 100 characters'
            });
        }

        // Check if email exists
        const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
        if (existingUser) {
            return res.status(409).json({
                success: false,
                error: 'Email already registered'
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const result = await db.prepare(`
            INSERT INTO users (email, password_hash, name, tier, credits_included, subscription_status)
            VALUES (?, ?, ?, 'free', 0, 'inactive')
        `).run(email.toLowerCase(), passwordHash, name.trim());

        // Create empty business profile
        await db.prepare(`
            INSERT INTO business_profiles (user_id) VALUES (?)
        `).run(result.lastInsertRowid);

        // Get created user
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

        // Generate token
        const token = generateToken(user);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    tier: user.tier,
                    creditsIncluded: user.credits_included,
                    creditsUsed: user.credits_used,
                    subscriptionStatus: user.subscription_status
                },
                token
            }
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({
            success: false,
            error: 'Registration failed. Please try again.'
        });
    }
});

// Login user
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validation
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        // Find user - handle both SQLite and PostgreSQL
        let user;
        try {
            // Use ? placeholder - the db wrapper will convert to $1 for PostgreSQL
            user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
        } catch (dbErr) {
            console.error('Database error during login:', dbErr);
            return res.status(500).json({
                success: false,
                error: 'Database error. Please try again.'
            });
        }
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Generate token
        const token = generateToken(user);

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    tier: user.tier,
                    creditsIncluded: user.credits_included,
                    creditsUsed: user.credits_used,
                    subscriptionStatus: user.subscription_status
                },
                token
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({
            success: false,
            error: 'Login failed. Please try again.'
        });
    }
});

// Verify token
router.get('/verify', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'No token provided'
            });
        }

        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
        if (!user) {
            return res.status(403).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    tier: user.tier,
                    creditsIncluded: user.credits_included,
                    creditsUsed: user.credits_used,
                    subscriptionStatus: user.subscription_status
                }
            }
        });
    } catch (err) {
        res.status(403).json({
            success: false,
            error: 'Invalid or expired token'
        });
    }
});

module.exports = router;
