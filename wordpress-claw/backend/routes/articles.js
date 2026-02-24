const express = require('express');
const db = require('../database/db');
const { authenticateToken, requireCredits } = require('../middleware/auth');
const { generateContent, generateImagePrompt } = require('../services/contentGeneration');
const { generateFeaturedImage } = require('../services/imageGeneration');
const { uploadImage } = require('../services/github');
const { publishToWordPress } = require('../services/wordpress');

const router = express.Router();

// Get all articles
router.get('/', authenticateToken, (req, res) => {
    try {
        const status = req.query.status;
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const offset = parseInt(req.query.offset) || 0;

        let query = `
            SELECT id, title, excerpt, keyword, status, wp_post_id, wp_url, 
                   featured_image_url, credits_used, created_at, updated_at, published_at
            FROM articles 
            WHERE user_id = ?
        `;
        const params = [req.user.id];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const articles = db.prepare(query).all(...params);

        // Get total count
        let countQuery = 'SELECT COUNT(*) as total FROM articles WHERE user_id = ?';
        const countParams = [req.user.id];
        if (status) {
            countQuery += ' AND status = ?';
            countParams.push(status);
        }
        const { total } = db.prepare(countQuery).get(...countParams);

        res.json({
            success: true,
            data: {
                articles: articles || [],
                pagination: {
                    total,
                    limit,
                    offset,
                    hasMore: offset + articles.length < total
                }
            }
        });
    } catch (err) {
        console.error('Get articles error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get articles'
        });
    }
});

// Get single article
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const article = db.prepare(`
            SELECT * FROM articles WHERE id = ? AND user_id = ?
        `).get(req.params.id, req.user.id);

        if (!article) {
            return res.status(404).json({
                success: false,
                error: 'Article not found'
            });
        }

        res.json({
            success: true,
            data: { article }
        });
    } catch (err) {
        console.error('Get article error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get article'
        });
    }
});

// Create new article (manual)
router.post('/', authenticateToken, requireCredits, (req, res) => {
    try {
        const { title, content, excerpt, keyword, metaTitle, metaDescription, tags, category } = req.body;

        if (!title || !content) {
            return res.status(400).json({
                success: false,
                error: 'Title and content are required'
            });
        }

        const result = db.prepare(`
            INSERT INTO articles (user_id, title, content, excerpt, keyword, status, meta_title, meta_description, tags, category, credits_used)
            VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, 0)
        `).run(
            req.user.id,
            title,
            content,
            excerpt || null,
            keyword || null,
            metaTitle || null,
            metaDescription || null,
            tags || null,
            category || null
        );

        // Log activity
        db.prepare(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'created', 'article', ?, ?)
        `).run(req.user.id, result.lastInsertRowid, JSON.stringify({ title, method: 'manual' }));

        const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(result.lastInsertRowid);

        res.status(201).json({
            success: true,
            message: 'Article created successfully',
            data: { article }
        });
    } catch (err) {
        console.error('Create article error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to create article'
        });
    }
});

// Generate article with AI
router.post('/generate', authenticateToken, requireCredits, async (req, res) => {
    try {
        const { keyword, customPrompt } = req.body;

        if (!keyword) {
            return res.status(400).json({
                success: false,
                error: 'Keyword is required for article generation'
            });
        }

        // Get business profile for context
        const businessProfile = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(req.user.id);

        // Get WordPress connection
        const wpConnection = db.prepare(`
            SELECT * FROM connections WHERE user_id = ? AND type = 'wordpress' AND status = 'active' LIMIT 1
        `).get(req.user.id);

        // Get GitHub connection for image uploads
        const githubConnection = db.prepare(`
            SELECT * FROM connections WHERE user_id = ? AND type = 'github' AND status = 'active' LIMIT 1
        `).get(req.user.id);

        // Create article in generating status
        const result = db.prepare(`
            INSERT INTO articles (user_id, keyword, status, credits_used)
            VALUES (?, ?, 'generating', 1)
        `).run(req.user.id, keyword);

        const articleId = result.lastInsertRowid;

        // Log activity
        db.prepare(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'started_generation', 'article', ?, ?)
        `).run(req.user.id, articleId, JSON.stringify({ keyword }));

        // Start generation (async)
        res.status(202).json({
            success: true,
            message: 'Article generation started',
            data: {
                articleId,
                status: 'generating'
            }
        });

        // Continue generation in background
        generateContent({
            keyword,
            businessProfile,
            customPrompt,
            userId: req.user.id,
            articleId
        }).then(async (generated) => {
            let featuredImageUrl = null;
            let githubImageUrl = null;
            let githubImagePath = null;
            let imageGenerationFailed = false;

            // Generate images if business profile has image settings
            if (businessProfile && businessProfile.image_count > 0) {
                try {
                    const imageCount = Math.min(businessProfile.image_count, 3);
                    const imageStyle = businessProfile.image_style || 'photorealistic';

                    // Generate image prompt
                    const imagePrompt = await generateImagePrompt(generated.title, keyword, businessProfile);
                    
                    // Apply style to prompt
                    const styledPrompt = `${imagePrompt}, ${imageStyle} style, high quality`;

                    // Generate the featured image
                    const imageResult = await generateFeaturedImage({
                        prompt: styledPrompt,
                        articleTitle: generated.title,
                        keyword
                    });

                    // Upload to GitHub if connected
                    if (githubConnection && imageResult.success) {
                        try {
                            const credentials = JSON.parse(githubConnection.credentials);
                            const uploadResult = await uploadImage({
                                imageBuffer: imageResult.buffer,
                                filename: imageResult.filename,
                                mimeType: imageResult.mimeType,
                                credentials
                            });

                            githubImageUrl = uploadResult.url;
                            githubImagePath = uploadResult.path;
                            featuredImageUrl = uploadResult.url;
                        } catch (uploadErr) {
                            console.error('GitHub upload error:', uploadErr);
                            // Still use the image even if upload fails
                            imageGenerationFailed = true;
                        }
                    }

                    // Log image generation
                    db.prepare(`
                        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                        VALUES (?, 'generated_image', 'article', ?, ?)
                    `).run(req.user.id, articleId, JSON.stringify({ 
                        style: imageStyle,
                        uploaded: !!githubImageUrl,
                        failed: imageGenerationFailed
                    }));

                } catch (imageErr) {
                    console.error('Image generation error:', imageErr);
                    imageGenerationFailed = true;
                }
            }

            // Update article with generated content
            db.prepare(`
                UPDATE articles 
                SET title = ?, content = ?, excerpt = ?, meta_title = ?, meta_description = ?, 
                    tags = ?, status = ?, featured_image_url = ?, github_image_url = ?, 
                    github_image_path = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                generated.title,
                generated.content,
                generated.excerpt,
                generated.metaTitle,
                generated.metaDescription,
                generated.tags,
                businessProfile?.auto_publish ? 'publishing' : 'review',
                featuredImageUrl,
                githubImageUrl,
                githubImagePath,
                articleId
            );

            // Deduct credit
            if (req.user.tier !== 'pro') {
                db.prepare('UPDATE users SET credits_used = credits_used + 1 WHERE id = ?').run(req.user.id);
            }

            // Auto-publish if enabled
            if (businessProfile?.auto_publish && wpConnection) {
                try {
                    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);
                    const wpCredentials = JSON.parse(wpConnection.credentials);
                    
                    const publishResult = await publishToWordPress({
                        article,
                        credentials: wpCredentials
                    });

                    // Update article as published
                    db.prepare(`
                        UPDATE articles 
                        SET status = ?, wp_post_id = ?, wp_url = ?, published_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `).run('published', publishResult.postId, publishResult.url, articleId);

                    // Log activity
                    db.prepare(`
                        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                        VALUES (?, 'auto_published', 'article', ?, ?)
                    `).run(req.user.id, articleId, JSON.stringify({ wpUrl: publishResult.url }));

                } catch (publishErr) {
                    console.error('Auto-publish error:', publishErr);
                    // Update status to review if auto-publish failed
                    db.prepare(`
                        UPDATE articles SET status = 'review', updated_at = CURRENT_TIMESTAMP WHERE id = ?
                    `).run(articleId);
                }
            }

            // Log activity
            db.prepare(`
                INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                VALUES (?, 'generated', 'article', ?, ?)
            `).run(req.user.id, articleId, JSON.stringify({ 
                title: generated.title,
                hasImage: !!featuredImageUrl,
                autoPublished: businessProfile?.auto_publish && wpConnection
            }));

        }).catch(err => {
            console.error('Generation error:', err);
            db.prepare(`
                UPDATE articles SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(articleId);

            db.prepare(`
                INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                VALUES (?, 'generation_failed', 'article', ?, ?)
            `).run(req.user.id, articleId, JSON.stringify({ error: err.message }));
        });

    } catch (err) {
        console.error('Generate article error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to start article generation'
        });
    }
});

// Update article
router.put('/:id', authenticateToken, (req, res) => {
    try {
        const { title, content, excerpt, keyword, metaTitle, metaDescription, tags, category } = req.body;
        const articleId = req.params.id;

        // Check article exists
        const existing = db.prepare('SELECT * FROM articles WHERE id = ? AND user_id = ?').get(articleId, req.user.id);
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: 'Article not found'
            });
        }

        const updates = [];
        const values = [];

        if (title !== undefined) {
            updates.push('title = ?');
            values.push(title);
        }
        if (content !== undefined) {
            updates.push('content = ?');
            values.push(content);
        }
        if (excerpt !== undefined) {
            updates.push('excerpt = ?');
            values.push(excerpt);
        }
        if (keyword !== undefined) {
            updates.push('keyword = ?');
            values.push(keyword);
        }
        if (metaTitle !== undefined) {
            updates.push('meta_title = ?');
            values.push(metaTitle);
        }
        if (metaDescription !== undefined) {
            updates.push('meta_description = ?');
            values.push(metaDescription);
        }
        if (tags !== undefined) {
            updates.push('tags = ?');
            values.push(tags);
        }
        if (category !== undefined) {
            updates.push('category = ?');
            values.push(category);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(articleId);

        db.prepare(`UPDATE articles SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId);

        res.json({
            success: true,
            message: 'Article updated successfully',
            data: { article }
        });
    } catch (err) {
        console.error('Update article error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update article'
        });
    }
});

// Publish article to WordPress
router.post('/:id/publish', authenticateToken, async (req, res) => {
    try {
        const articleId = req.params.id;

        // Get article
        const article = db.prepare('SELECT * FROM articles WHERE id = ? AND user_id = ?').get(articleId, req.user.id);
        if (!article) {
            return res.status(404).json({
                success: false,
                error: 'Article not found'
            });
        }

        if (article.status === 'published') {
            return res.status(400).json({
                success: false,
                error: 'Article is already published'
            });
        }

        // Get WordPress connection
        const wpConnection = db.prepare(`
            SELECT * FROM connections WHERE user_id = ? AND type = 'wordpress' AND status = 'active' LIMIT 1
        `).get(req.user.id);

        if (!wpConnection) {
            return res.status(400).json({
                success: false,
                error: 'No active WordPress connection found. Please set up your WordPress connection first.'
            });
        }

        // Publish to WordPress
        const wpCredentials = JSON.parse(wpConnection.credentials);
        const publishResult = await publishToWordPress({
            article,
            credentials: wpCredentials
        });

        // Update article
        db.prepare(`
            UPDATE articles 
            SET status = 'published', wp_post_id = ?, wp_url = ?, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(publishResult.postId, publishResult.url, articleId);

        // Log activity
        db.prepare(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'published', 'article', ?, ?)
        `).run(req.user.id, articleId, JSON.stringify({ wpUrl: publishResult.url }));

        res.json({
            success: true,
            message: 'Article published successfully',
            data: {
                articleId,
                wpUrl: publishResult.url,
                wpPostId: publishResult.postId
            }
        });
    } catch (err) {
        console.error('Publish article error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to publish article: ' + err.message
        });
    }
});

// Delete article
router.delete('/:id', authenticateToken, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM articles WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Article not found'
            });
        }

        res.json({
            success: true,
            message: 'Article deleted successfully'
        });
    } catch (err) {
        console.error('Delete article error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to delete article'
        });
    }
});

module.exports = router;
