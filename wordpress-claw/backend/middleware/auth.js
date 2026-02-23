const jwt = require('jsonwebtoken');
const db = require('../database/db');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

/**
 * Generate JWT token for user
 */
function generateToken(user) {
    return jwt.sign(
        { 
            userId: user.id, 
            email: user.email,
            tier: user.tier 
        },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
}

/**
 * Verify and decode JWT token
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

/**
 * Authentication middleware
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'Access token required' 
        });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(403).json({ 
            success: false, 
            error: 'Invalid or expired token' 
        });
    }

    // Get fresh user data from database
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
        if (!user) {
            return res.status(403).json({ 
                success: false, 
                error: 'User not found' 
            });
        }

        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            tier: user.tier,
            creditsIncluded: user.credits_included,
            creditsUsed: user.credits_used,
            subscriptionStatus: user.subscription_status
        };
        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'Authentication error' 
        });
    }
}

/**
 * Optional authentication - doesn't fail if no token
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            try {
                const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
                if (user) {
                    req.user = {
                        id: user.id,
                        email: user.email,
                        name: user.name,
                        tier: user.tier,
                        creditsIncluded: user.credits_included,
                        creditsUsed: user.credits_used,
                        subscriptionStatus: user.subscription_status
                    };
                }
            } catch (err) {
                console.error('Optional auth error:', err);
            }
        }
    }
    next();
}

/**
 * Check if user has required tier
 */
function requireTier(tiers) {
    const tierArray = Array.isArray(tiers) ? tiers : [tiers];
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required' 
            });
        }
        if (!tierArray.includes(req.user.tier)) {
            return res.status(403).json({ 
                success: false, 
                error: 'Subscription required for this feature',
                requiredTier: tierArray
            });
        }
        next();
    };
}

/**
 * Check if user has available credits
 */
function requireCredits(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ 
            success: false, 
            error: 'Authentication required' 
        });
    }

    // Pro users have unlimited credits
    if (req.user.tier === 'pro') {
        return next();
    }

    const availableCredits = req.user.creditsIncluded - req.user.creditsUsed;
    if (availableCredits < 1) {
        return res.status(403).json({ 
            success: false, 
            error: 'Insufficient credits',
            creditsNeeded: 1,
            creditsAvailable: availableCredits
        });
    }
    next();
}

module.exports = {
    generateToken,
    verifyToken,
    authenticateToken,
    optionalAuth,
    requireTier,
    requireCredits
};