const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get current user profile
router.get('/profile', authenticateToken, (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                user: req.user
            }
        });
    } catch (err) {
        console.error('Get profile error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get profile'
        });
    }
});

// Update user profile
router.patch('/profile', authenticateToken, (req, res) => {
    try {
        const { name } = req.body;

        if (name && (name.length < 2 || name.length > 100)) {
            return res.status(400).json({
                success: false,
                error: 'Name must be between 2 and 100 characters'
            });
        }

        const updates = [];
        const values = [];

        if (name) {
            updates.push('name = ?');
            values.push(name.trim());
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.user.id);

        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        // Get updated user
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

        res.json({
            success: true,
            message: 'Profile updated successfully',
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
        console.error('Update profile error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update profile'
        });
    }
});

// Get dashboard stats
router.get('/dashboard', authenticateToken, (req, res) => {
    try {
        const userId = req.user.id;

        // Get article stats
        const articleStats = db.prepare(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
                SUM(CASE WHEN status = 'generating' THEN 1 ELSE 0 END) as generating
            FROM articles 
            WHERE user_id = ?
        `).get(userId);

        // Get recent articles
        const recentArticles = db.prepare(`
            SELECT id, title, status, keyword, wp_url, created_at
            FROM articles 
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT 5
        `).all(userId);

        // Get connections count
        const connectionsCount = db.prepare(`
            SELECT COUNT(*) as count FROM connections 
            WHERE user_id = ? AND status = 'active'
        `).get(userId);

        // Get business profile status
        const businessProfile = db.prepare(`
            SELECT company_name, industry FROM business_profiles 
            WHERE user_id = ?
        `).get(userId);

        const profileComplete = businessProfile && businessProfile.company_name && businessProfile.industry;

        // Calculate credits
        const creditsAvailable = req.user.tier === 'pro' 
            ? 'unlimited' 
            : Math.max(0, req.user.creditsIncluded - req.user.creditsUsed);

        res.json({
            success: true,
            data: {
                stats: {
                    articles: {
                        total: articleStats.total || 0,
                        published: articleStats.published || 0,
                        drafts: articleStats.drafts || 0,
                        generating: articleStats.generating || 0
                    },
                    connections: connectionsCount.count || 0,
                    credits: {
                        available: creditsAvailable,
                        used: req.user.creditsUsed,
                        included: req.user.creditsIncluded
                    },
                    profileComplete: !!profileComplete
                },
                recentArticles: recentArticles || [],
                businessProfile: businessProfile || {},
                tier: req.user.tier
            }
        });
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get dashboard data'
        });
    }
});

// Get user activity log
router.get('/activity', authenticateToken, (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = parseInt(req.query.offset) || 0;

        const activities = db.prepare(`
            SELECT action, entity_type, entity_id, details, created_at
            FROM activity_log 
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `).all(req.user.id, limit, offset);

        res.json({
            success: true,
            data: {
                activities: activities.map(a => ({
                    ...a,
                    details: a.details ? JSON.parse(a.details) : null
                }))
            }
        });
    } catch (err) {
        console.error('Activity log error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get activity log'
        });
    }
});

module.exports = router;