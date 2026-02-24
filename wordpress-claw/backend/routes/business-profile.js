const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Valid values for validation
const VALID_TONES = ['professional', 'casual', 'friendly', 'formal', 'witty'];
const VALID_CONTENT_TYPES = ['blog_post', 'article', 'news', 'tutorial', 'review'];
const VALID_IMAGE_STYLES = ['photorealistic', 'illustration', '3d', 'photo'];

// Get business profile
router.get('/', authenticateToken, async (req, res) => {
    try {
        const profile = await db.prepare(`
            SELECT * FROM business_profiles WHERE user_id = ?
        `).get(req.user.id);

        if (!profile) {
            // Create default profile if none exists
            await db.prepare('INSERT INTO business_profiles (user_id) VALUES (?)').run(req.user.id);
            const newProfile = await db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);
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

// Get business profile completion status
router.get('/completion', authenticateToken, async (req, res) => {
    try {
        const profile = await db.prepare(`
            SELECT * FROM business_profiles WHERE user_id = ?
        `).get(req.user.id);

        const connections = await db.prepare(`
            SELECT type, status FROM connections WHERE user_id = ?
        `).all(req.user.id);

        if (!profile) {
            return res.json({
                success: true,
                data: {
                    completion: 0,
                    missing: ['company_name', 'industry', 'description', 'target_audience', 'keywords', 'image_preferences', 'wordpress_connection'],
                    ready: false
                }
            });
        }

        // Calculate completion percentage
        const fields = [
            { name: 'company_name', value: profile.company_name, weight: 15 },
            { name: 'industry', value: profile.industry, weight: 10 },
            { name: 'description', value: profile.description, weight: 10 },
            { name: 'target_audience', value: profile.target_audience, weight: 10 },
            { name: 'keywords', value: profile.keywords, weight: 15 },
            { name: 'image_preferences', value: profile.image_count && profile.image_style, weight: 10 },
            { name: 'wordpress_connection', value: connections.some(c => c.type === 'wordpress' && c.status === 'active'), weight: 20 },
            { name: 'github_connection', value: connections.some(c => c.type === 'github' && c.status === 'active'), weight: 10 }
        ];

        let completion = 0;
        const missing = [];

        fields.forEach(field => {
            if (field.value) {
                completion += field.weight;
            } else {
                missing.push(field.name);
            }
        });

        // Cap at 100
        completion = Math.min(100, completion);

        res.json({
            success: true,
            data: {
                completion,
                missing,
                ready: completion >= 80,
                canGenerate: !!(profile.company_name && profile.industry),
                canPublish: connections.some(c => c.type === 'wordpress' && c.status === 'active'),
                fields: {
                    hasCompanyName: !!profile.company_name,
                    hasIndustry: !!profile.industry,
                    hasDescription: !!profile.description,
                    hasTargetAudience: !!profile.target_audience,
                    hasKeywords: !!profile.keywords,
                    hasImagePreferences: !!(profile.image_count && profile.image_style),
                    hasWordPress: connections.some(c => c.type === 'wordpress' && c.status === 'active'),
                    hasGitHub: connections.some(c => c.type === 'github' && c.status === 'active')
                }
            }
        });
    } catch (err) {
        console.error('Get completion error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get profile completion'
        });
    }
});

// Update business profile
router.put('/', authenticateToken, async (req, res) => {
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
            uniqueSellingPoints,
            imageCount,
            imageStyle,
            autoPublish
        } = req.body;

        // Validate tone
        if (tone && !VALID_TONES.includes(tone)) {
            return res.status(400).json({
                success: false,
                error: `Invalid tone. Must be one of: ${VALID_TONES.join(', ')}`
            });
        }

        // Validate content type
        if (contentType && !VALID_CONTENT_TYPES.includes(contentType)) {
            return res.status(400).json({
                success: false,
                error: `Invalid content type. Must be one of: ${VALID_CONTENT_TYPES.join(', ')}`
            });
        }

        // Validate word count
        if (wordCount && (wordCount < 300 || wordCount > 3000)) {
            return res.status(400).json({
                success: false,
                error: 'Word count must be between 300 and 3000'
            });
        }

        // Validate image count
        if (imageCount !== undefined && (imageCount < 1 || imageCount > 3)) {
            return res.status(400).json({
                success: false,
                error: 'Image count must be between 1 and 3'
            });
        }

        // Validate image style
        if (imageStyle && !VALID_IMAGE_STYLES.includes(imageStyle)) {
            return res.status(400).json({
                success: false,
                error: `Invalid image style. Must be one of: ${VALID_IMAGE_STYLES.join(', ')}`
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
        if (imageCount !== undefined) {
            updates.push('image_count = ?');
            values.push(imageCount);
        }
        if (imageStyle !== undefined) {
            updates.push('image_style = ?');
            values.push(imageStyle);
        }
        if (autoPublish !== undefined) {
            updates.push('auto_publish = ?');
            values.push(autoPublish ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(req.user.id);

        await db.prepare(`
            UPDATE business_profiles 
            SET ${updates.join(', ')} 
            WHERE user_id = ?
        `).run(...values);

        // Get updated profile
        const profile = await db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);

        // Log activity
        await db.prepare(`
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
router.patch('/', authenticateToken, async (req, res) => {
    try {
        const allowedFields = [
            'companyName', 'industry', 'description', 'targetAudience',
            'location', 'tone', 'wordCount', 'contentType', 'keywords',
            'competitors', 'uniqueSellingPoints', 'imageCount', 'imageStyle', 'autoPublish'
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

        await db.prepare(`
            UPDATE business_profiles 
            SET ${updates.join(', ')} 
            WHERE user_id = ?
        `).run(...values);

        const profile = await db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);

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
