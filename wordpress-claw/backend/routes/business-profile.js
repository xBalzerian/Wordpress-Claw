const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get business profile
router.get('/', authenticateToken, (req, res) => {
    try {
        const profile = db.prepare(`
            SELECT * FROM business_profiles WHERE user_id = ?
        `).get(req.user.id);

        if (!profile) {
            // Create default profile if none exists
            db.prepare('INSERT INTO business_profiles (user_id) VALUES (?)').run(req.user.id);
            const newProfile = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);
            return res.json({
                success: true,
                data: { profile: newProfile }
            });
        }

        res.json({
            success: true,
            data: { profile }
        });
    } catch (err) {
        console.error('Get business profile error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get business profile'
        });
    }
});

// Update business profile
router.put('/', authenticateToken, (req, res) => {
    try {
        const {
            companyName,
            industry,
            description,
            targetAudience,
            location,
            tone,
            wordCount,
            contentType,
            keywords,
            competitors,
            uniqueSellingPoints
        } = req.body;

        // Validate tone
        const validTones = ['professional', 'casual', 'friendly', 'formal', 'witty'];
        if (tone && !validTones.includes(tone)) {
            return res.status(400).json({
                success: false,
                error: `Invalid tone. Must be one of: ${validTones.join(', ')}`
            });
        }

        // Validate content type
        const validContentTypes = ['blog_post', 'article', 'news', 'tutorial', 'review'];
        if (contentType && !validContentTypes.includes(contentType)) {
            return res.status(400).json({
                success: false,
                error: `Invalid content type. Must be one of: ${validContentTypes.join(', ')}`
            });
        }

        // Validate word count
        if (wordCount && (wordCount < 300 || wordCount > 3000)) {
            return res.status(400).json({
                success: false,
                error: 'Word count must be between 300 and 3000'
            });
        }

        // Build update query
        const updates = [];
        const values = [];

        if (companyName !== undefined) {
            updates.push('company_name = ?');
            values.push(companyName || null);
        }
        if (industry !== undefined) {
            updates.push('industry = ?');
            values.push(industry || null);
        }
        if (description !== undefined) {
            updates.push('description = ?');
            values.push(description || null);
        }
        if (targetAudience !== undefined) {
            updates.push('target_audience = ?');
            values.push(targetAudience || null);
        }
        if (location !== undefined) {
            updates.push('location = ?');
            values.push(location || null);
        }
        if (tone !== undefined) {
            updates.push('tone = ?');
            values.push(tone);
        }
        if (wordCount !== undefined) {
            updates.push('word_count = ?');
            values.push(wordCount);
        }
        if (contentType !== undefined) {
            updates.push('content_type = ?');
            values.push(contentType);
        }
        if (keywords !== undefined) {
            updates.push('keywords = ?');
            values.push(keywords || null);
        }
        if (competitors !== undefined) {
            updates.push('competitors = ?');
            values.push(competitors || null);
        }
        if (uniqueSellingPoints !== undefined) {
            updates.push('unique_selling_points = ?');
            values.push(uniqueSellingPoints || null);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.user.id);

        db.prepare(`
            UPDATE business_profiles 
            SET ${updates.join(', ')} 
            WHERE user_id = ?
        `).run(...values);

        // Get updated profile
        const profile = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);

        // Log activity
        db.prepare(`
            INSERT INTO activity_log (user_id, action, entity_type, details)
            VALUES (?, 'updated', 'business_profile', ?)
        `).run(req.user.id, JSON.stringify({ fields: updates.length }));

        res.json({
            success: true,
            message: 'Business profile updated successfully',
            data: { profile }
        });
    } catch (err) {
        console.error('Update business profile error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update business profile'
        });
    }
});

// Patch business profile (partial update)
router.patch('/', authenticateToken, (req, res) => {
    try {
        const allowedFields = [
            'companyName', 'industry', 'description', 'targetAudience',
            'location', 'tone', 'wordCount', 'contentType', 'keywords',
            'competitors', 'uniqueSellingPoints'
        ];

        const updates = [];
        const values = [];

        for (const [key, value] of Object.entries(req.body)) {
            if (allowedFields.includes(key)) {
                const dbField = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                updates.push(`${dbField} = ?`);
                values.push(value);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.user.id);

        db.prepare(`
            UPDATE business_profiles 
            SET ${updates.join(', ')} 
            WHERE user_id = ?
        `).run(...values);

        const profile = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);

        res.json({
            success: true,
            message: 'Business profile updated',
            data: { profile }
        });
    } catch (err) {
        console.error('Patch business profile error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update business profile'
        });
    }
});

module.exports = router;