const express = require('express');
const db = require('../database/db');
const { authenticateToken, requireCredits } = require('../middleware/auth');
const SummonAgent = require('../services/summonAgent');

const router = express.Router();

/**
 * Get all content queue items for the user
 * GET /api/content-queue
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        const status = req.query.status;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;

        let query = `
            SELECT id, service_url, main_keyword, cluster_keywords, status, 
                   wp_post_url, feature_image, created_at, updated_at
            FROM content_queue 
            WHERE user_id = ?
        `;
        const params = [req.user.id];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const items = await db.prepare(query).all(...params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM content_queue WHERE user_id = ?';
        const countParams = [req.user.id];
        if (status) {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        const { total } = await db.prepare(countQuery).get(...countParams);

        // Get status counts
        const statusCounts = await db.prepare(`
            SELECT status, COUNT(*) as count 
            FROM content_queue 
            WHERE user_id = ? 
            GROUP BY status
        `).all(req.user.id);

        const counts = {
            pending: 0,
            processing: 0,
            done: 0,
            error: 0,
            total: parseInt(total)
        };
        
        for (const row of statusCounts) {
            counts[row.status] = parseInt(row.count);
        }

        res.json({
            success: true,
            data: {
                items: items || [],
                counts,
                pagination: {
                    total: parseInt(total),
                    limit,
                    offset,
                    hasMore: offset + (items?.length || 0) < parseInt(total)
                }
            }
        });
    } catch (err) {
        console.error('Get content queue error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get content queue'
        });
    }
});

/**
 * Add new item to content queue
 * POST /api/content-queue
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { service_url, main_keyword, cluster_keywords } = req.body;

        if (!main_keyword || !main_keyword.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Main keyword is required'
            });
        }

        const result = await db.prepare(`
            INSERT INTO content_queue (user_id, service_url, main_keyword, cluster_keywords, status)
            VALUES (?, ?, ?, ?, 'pending')
        `).run(
            req.user.id,
            service_url || null,
            main_keyword.trim(),
            cluster_keywords || null
        );

        const item = await db.prepare('SELECT * FROM content_queue WHERE id = ?').get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'Item added to queue',
            data: { item }
        });
    } catch (err) {
        console.error('Add to queue error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to add item to queue'
        });
    }
});

/**
 * Update a content queue item
 * PUT /api/content-queue/:id
 */
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { service_url, main_keyword, cluster_keywords, status, wp_post_url, feature_image } = req.body;
        const itemId = req.params.id;

        // Check item exists and belongs to user
        const existing = await db.prepare('SELECT * FROM content_queue WHERE id = ? AND user_id = ?').get(itemId, req.user.id);
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: 'Item not found'
            });
        }

        const updates = [];
        const values = [];

        if (service_url !== undefined) {
            updates.push('service_url = ?');
            values.push(service_url);
        }
        if (main_keyword !== undefined) {
            updates.push('main_keyword = ?');
            values.push(main_keyword.trim());
        }
        if (cluster_keywords !== undefined) {
            updates.push('cluster_keywords = ?');
            values.push(cluster_keywords);
        }
        if (status !== undefined) {
            const validStatuses = ['pending', 'processing', 'done', 'error'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status. Must be: pending, processing, done, or error'
                });
            }
            updates.push('status = ?');
            values.push(status);
        }
        if (wp_post_url !== undefined) {
            updates.push('wp_post_url = ?');
            values.push(wp_post_url);
        }
        if (feature_image !== undefined) {
            updates.push('feature_image = ?');
            values.push(feature_image);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(itemId);

        await db.prepare(`UPDATE content_queue SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const item = await db.prepare('SELECT * FROM content_queue WHERE id = ?').get(itemId);

        res.json({
            success: true,
            message: 'Item updated successfully',
            data: { item }
        });
    } catch (err) {
        console.error('Update queue item error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update item'
        });
    }
});

/**
 * Delete a content queue item
 * DELETE /api/content-queue/:id
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const result = await db.prepare('DELETE FROM content_queue WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Item not found'
            });
        }

        res.json({
            success: true,
            message: 'Item deleted successfully'
        });
    } catch (err) {
        console.error('Delete queue item error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to delete item'
        });
    }
});

/**
 * Process a content queue item with AI
 * POST /api/content-queue/:id/process
 */
router.post('/:id/process', authenticateToken, requireCredits, async (req, res) => {
    try {
        const itemId = req.params.id;

        // Get the queue item
        const item = await db.prepare('SELECT * FROM content_queue WHERE id = ? AND user_id = ?').get(itemId, req.user.id);
        if (!item) {
            return res.status(404).json({
                success: false,
                error: 'Item not found'
            });
        }

        if (!item.main_keyword) {
            return res.status(400).json({
                success: false,
                error: 'Item has no main keyword to process'
            });
        }

        // Update status to processing
        await db.prepare(`
            UPDATE content_queue SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(itemId);

        // Start processing (async)
        res.status(202).json({
            success: true,
            message: 'Processing started',
            data: {
                itemId,
                status: 'processing',
                keyword: item.main_keyword
            }
        });

        // Continue processing in background
        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        // Start content workflow
        const result = await agent.startContentWorkflow(item.main_keyword);

        if (!result.success) {
            await db.prepare(`
                UPDATE content_queue SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(itemId);
            return;
        }

        // Generate the article
        const generateResult = await agent.generateArticle(item.main_keyword);

        if (!generateResult.success || !generateResult.data) {
            await db.prepare(`
                UPDATE content_queue SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(itemId);
            return;
        }

        const article = generateResult.data;
        let wpPostUrl = null;
        let featureImage = null;

        // Generate featured image if business profile has image settings
        try {
            const businessProfile = await db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);
            if (businessProfile && businessProfile.image_count > 0) {
                const imageResult = await agent.generateFeaturedImage(item.main_keyword, article.title);
                if (imageResult.success && imageResult.data) {
                    featureImage = imageResult.data.url || null;
                }
            }
        } catch (imageErr) {
            console.error('Image generation error:', imageErr);
            // Continue without image
        }

        // Auto-publish if enabled
        try {
            const businessProfile = await db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);
            if (businessProfile?.auto_publish) {
                const publishResult = await agent.publishToWordPress(article.id);
                if (publishResult.success) {
                    wpPostUrl = publishResult.data?.wpUrl || null;
                }
            }
        } catch (publishErr) {
            console.error('Auto-publish error:', publishErr);
            // Continue without publishing
        }

        // Update queue item as done
        await db.prepare(`
            UPDATE content_queue 
            SET status = 'done', 
                wp_post_url = ?, 
                feature_image = ?,
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(wpPostUrl, featureImage, itemId);

        // Deduct credit if not pro
        if (req.user.tier !== 'pro') {
            await db.prepare('UPDATE users SET credits_used = credits_used + 1 WHERE id = ?').run(req.user.id);
        }

    } catch (err) {
        console.error('Process queue item error:', err);
        // Update status to error
        try {
            await db.prepare(`
                UPDATE content_queue SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(req.params.id);
        } catch (updateErr) {
            console.error('Failed to update error status:', updateErr);
        }
    }
});

/**
 * Process all pending items
 * POST /api/content-queue/process-all
 */
router.post('/process-all', authenticateToken, requireCredits, async (req, res) => {
    try {
        // Get all pending items
        const pendingItems = await db.prepare(`
            SELECT id, main_keyword 
            FROM content_queue 
            WHERE user_id = ? AND status = 'pending' AND main_keyword IS NOT NULL
            ORDER BY created_at ASC
        `).all(req.user.id);

        if (pendingItems.length === 0) {
            return res.json({
                success: true,
                message: 'No pending items to process',
                data: { processed: 0, total: 0 }
            });
        }

        // Check credits
        const user = await db.prepare('SELECT tier, credits_included, credits_used FROM users WHERE id = ?').get(req.user.id);
        const creditsAvailable = user.tier === 'pro' 
            ? Infinity 
            : Math.max(0, user.credits_included - user.credits_used);

        if (creditsAvailable < pendingItems.length) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient credits',
                message: `You need ${pendingItems.length} credits but only have ${creditsAvailable}. Please upgrade your plan or purchase more credits.`
            });
        }

        // Update all to processing
        for (const item of pendingItems) {
            await db.prepare(`
                UPDATE content_queue SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(item.id);
        }

        res.json({
            success: true,
            message: `Started processing ${pendingItems.length} items`,
            data: {
                total: pendingItems.length,
                items: pendingItems.map(i => ({ id: i.id, keyword: i.main_keyword }))
            }
        });

        // Process in background
        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        for (const item of pendingItems) {
            try {
                // Generate article
                const result = await agent.generateArticle(item.main_keyword);
                
                if (result.success && result.data) {
                    const article = result.data;
                    let wpPostUrl = null;
                    let featureImage = null;

                    // Try to generate image
                    try {
                        const imageResult = await agent.generateFeaturedImage(item.main_keyword, article.title);
                        if (imageResult.success && imageResult.data) {
                            featureImage = imageResult.data.url || null;
                        }
                    } catch (e) { /* ignore */ }

                    // Try to publish if auto-publish enabled
                    try {
                        const businessProfile = await db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);
                        if (businessProfile?.auto_publish) {
                            const publishResult = await agent.publishToWordPress(article.id);
                            if (publishResult.success) {
                                wpPostUrl = publishResult.data?.wpUrl || null;
                            }
                        }
                    } catch (e) { /* ignore */ }

                    // Mark as done
                    await db.prepare(`
                        UPDATE content_queue 
                        SET status = 'done', wp_post_url = ?, feature_image = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `).run(wpPostUrl, featureImage, item.id);

                    // Deduct credit
                    if (user.tier !== 'pro') {
                        await db.prepare('UPDATE users SET credits_used = credits_used + 1 WHERE id = ?').run(req.user.id);
                    }
                } else {
                    await db.prepare(`
                        UPDATE content_queue SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?
                    `).run(item.id);
                }

                // Delay between items
                await new Promise(r => setTimeout(r, 2000));

            } catch (itemErr) {
                console.error(`Error processing item ${item.id}:`, itemErr);
                await db.prepare(`
                    UPDATE content_queue SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?
                `).run(item.id);
            }
        }

    } catch (err) {
        console.error('Process all error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to process items'
        });
    }
});

module.exports = router;
