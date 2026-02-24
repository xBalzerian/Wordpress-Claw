const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');
const SummonAgent = require('../services/summonAgent');
const SpreadsheetAgent = require('../services/spreadsheetAgent');

const router = express.Router();

/**
 * Get or create chat session
 * Returns session data with proactive greeting based on user state
 */
router.get('/session', authenticateToken, async (req, res) => {
    try {
        // Look for existing active session
        let session = db.prepare(`
            SELECT * FROM clawbot_sessions 
            WHERE user_id = ? 
            ORDER BY last_activity_at DESC 
            LIMIT 1
        `).get(req.user.id);

        // Initialize SummonAgent to get proactive greeting
        const agent = new SummonAgent(req.user.id);
        await agent.initialize();
        const greeting = agent.getProactiveGreeting();

        if (!session) {
            // Create new session
            const sessionKey = uuidv4();
            const initialContext = buildInitialContext(req.user.id);
            
            const result = db.prepare(`
                INSERT INTO clawbot_sessions (user_id, session_key, messages, context)
                VALUES (?, ?, ?, ?)
            `).run(
                req.user.id,
                sessionKey,
                JSON.stringify([{
                    role: 'assistant',
                    content: greeting.message,
                    timestamp: new Date().toISOString(),
                    type: greeting.type,
                    actions: greeting.actions || null,
                    suggestions: greeting.suggestions || null
                }]),
                JSON.stringify(initialContext)
            );

            session = db.prepare('SELECT * FROM clawbot_sessions WHERE id = ?').get(result.lastInsertRowid);
        } else {
            // Update context with latest user state
            const updatedContext = buildInitialContext(req.user.id);
            
            // Check if we should update the greeting (if it's been a while)
            const lastActivity = new Date(session.last_activity_at);
            const hoursSinceActivity = (Date.now() - lastActivity.getTime()) / (1000 * 60 * 60);
            
            if (hoursSinceActivity > 1) {
                // Add new greeting message
                const messages = JSON.parse(session.messages || '[]');
                messages.push({
                    role: 'assistant',
                    content: greeting.message,
                    timestamp: new Date().toISOString(),
                    type: greeting.type,
                    actions: greeting.actions || null,
                    suggestions: greeting.suggestions || null
                });

                db.prepare(`
                    UPDATE clawbot_sessions 
                    SET messages = ?, context = ?, last_activity_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(
                    JSON.stringify(messages.slice(-50)),
                    JSON.stringify(updatedContext),
                    session.id
                );

                session.messages = JSON.stringify(messages);
                session.context = JSON.stringify(updatedContext);
            } else {
                db.prepare(`
                    UPDATE clawbot_sessions 
                    SET context = ?, last_activity_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(JSON.stringify(updatedContext), session.id);
            }
        }

        res.json({
            success: true,
            data: {
                sessionKey: session.session_key,
                messages: JSON.parse(session.messages),
                context: JSON.parse(session.context || '{}')
            }
        });
    } catch (err) {
        console.error('Get session error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get chat session'
        });
    }
});

/**
 * Send message to ClawBot
 * Main endpoint for conversational AI interaction
 */
router.post('/message', authenticateToken, async (req, res) => {
    try {
        const { message, sessionKey } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        // Get or create session
        let session = await getOrCreateSession(sessionKey, req.user.id);

        // Parse existing messages
        const messages = JSON.parse(session.messages || '[]');

        // Add user message
        messages.push({
            role: 'user',
            content: message.trim(),
            timestamp: new Date().toISOString()
        });

        // Initialize SummonAgent and process message
        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        // Get session context for continuity
        const sessionContext = JSON.parse(session.context || '{}');
        
        // Process the message
        const response = await agent.processMessage(message.trim(), sessionContext);

        // Add assistant response
        messages.push({
            role: 'assistant',
            content: response.message,
            timestamp: new Date().toISOString(),
            type: response.type || 'general',
            actions: response.actions || null,
            suggestions: response.suggestions || null,
            data: response.data || null
        });

        // Update context
        const updatedContext = {
            ...sessionContext,
            lastTopic: response.type || sessionContext.lastTopic,
            pendingAction: response.actions?.find(a => a.type === 'awaiting_input') ? 
                response.actions[0] : null,
            lastInteraction: new Date().toISOString()
        };

        // Update session
        db.prepare(`
            UPDATE clawbot_sessions 
            SET messages = ?, context = ?, last_activity_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            JSON.stringify(messages.slice(-50)), // Keep last 50 messages
            JSON.stringify(updatedContext),
            session.id
        );

        res.json({
            success: true,
            data: {
                sessionKey: session.session_key,
                message: response.message,
                type: response.type || 'general',
                actions: response.actions || null,
                suggestions: response.suggestions || null,
                data: response.data || null,
                context: updatedContext
            }
        });
    } catch (err) {
        console.error('ClawBot message error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to process message'
        });
    }
});

/**
 * Execute action (with user confirmation)
 * Handles workflow actions like generating content, publishing, etc.
 */
router.post('/action', authenticateToken, async (req, res) => {
    try {
        const { sessionKey, action, params = {} } = req.body;

        if (!sessionKey || !action) {
            return res.status(400).json({
                success: false,
                error: 'Session key and action are required'
            });
        }

        const session = db.prepare('SELECT * FROM clawbot_sessions WHERE session_key = ? AND user_id = ?')
            .get(sessionKey, req.user.id);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        // Initialize agent and execute action
        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        // Restore workflow state if exists in session
        const sessionContext = JSON.parse(session.context || '{}');
        if (sessionContext.workflowState) {
            agent.workflowState = sessionContext.workflowState;
        }

        // Execute the action
        const result = await agent.executeAction(action, params);

        // Update session context
        const updatedContext = {
            ...sessionContext,
            workflowState: agent.workflowState,
            lastAction: { action, result: result.success, timestamp: new Date().toISOString() }
        };

        // Add response to messages if there's a message
        const messages = JSON.parse(session.messages || '[]');
        if (result.message) {
            messages.push({
                role: 'assistant',
                content: result.message,
                timestamp: new Date().toISOString(),
                type: result.step || 'action_result',
                actions: result.actions || null,
                data: result.data || null
            });
        }

        db.prepare(`
            UPDATE clawbot_sessions 
            SET messages = ?, context = ?, last_activity_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(
            JSON.stringify(messages.slice(-50)),
            JSON.stringify(updatedContext),
            session.id
        );

        res.json({
            success: result.success,
            message: result.message || 'Action completed',
            step: result.step,
            data: result.data,
            actions: result.actions || null
        });
    } catch (err) {
        console.error('ClawBot action error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to execute action: ' + err.message
        });
    }
});

/**
 * Start content creation workflow
 * Dedicated endpoint for starting the content workflow
 */
router.post('/workflow/content', authenticateToken, async (req, res) => {
    try {
        const { keyword, sessionKey } = req.body;

        if (!keyword) {
            return res.status(400).json({
                success: false,
                error: 'Keyword is required'
            });
        }

        // Get or create session
        let session = await getOrCreateSession(sessionKey, req.user.id);

        // Initialize agent and start workflow
        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        const result = await agent.startContentWorkflow(keyword);

        // Update session
        const messages = JSON.parse(session.messages || '[]');
        messages.push(
            {
                role: 'user',
                content: `I want to rank for "${keyword}"`,
                timestamp: new Date().toISOString()
            },
            {
                role: 'assistant',
                content: result.message,
                timestamp: new Date().toISOString(),
                type: 'research_complete',
                actions: result.actions,
                suggestions: result.suggestions,
                data: result.data
            }
        );

        const updatedContext = {
            ...JSON.parse(session.context || '{}'),
            workflowState: agent.workflowState,
            lastTopic: 'content_creation'
        };

        db.prepare(`
            UPDATE clawbot_sessions 
            SET messages = ?, context = ?, last_activity_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(
            JSON.stringify(messages.slice(-50)),
            JSON.stringify(updatedContext),
            session.id
        );

        res.json({
            success: result.success,
            data: {
                sessionKey: session.session_key,
                step: result.step,
                message: result.message,
                actions: result.actions,
                suggestions: result.suggestions,
                researchData: result.data
            }
        });
    } catch (err) {
        console.error('Content workflow error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to start content workflow: ' + err.message
        });
    }
});

/**
 * Generate article content
 */
router.post('/workflow/generate', authenticateToken, async (req, res) => {
    try {
        const { keyword, sessionKey, options = {} } = req.body;

        if (!keyword) {
            return res.status(400).json({
                success: false,
                error: 'Keyword is required'
            });
        }

        // Check credits
        const user = db.prepare('SELECT tier, credits_included, credits_used FROM users WHERE id = ?').get(req.user.id);
        const creditsAvailable = user.tier === 'pro' 
            ? Infinity 
            : Math.max(0, user.credits_included - user.credits_used);

        if (creditsAvailable <= 0) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient credits',
                message: 'You have no credits remaining. Please upgrade your plan or purchase more credits.'
            });
        }

        // Get session
        const session = db.prepare('SELECT * FROM clawbot_sessions WHERE session_key = ? AND user_id = ?')
            .get(sessionKey, req.user.id);

        // Initialize agent
        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        // Restore workflow state if exists
        if (session?.context) {
            const context = JSON.parse(session.context);
            if (context.workflowState) {
                agent.workflowState = context.workflowState;
            }
        }

        // Generate article
        const result = await agent.generateArticle(keyword, options);

        // Update session if exists
        if (session) {
            const messages = JSON.parse(session.messages || '[]');
            messages.push({
                role: 'assistant',
                content: result.message,
                timestamp: new Date().toISOString(),
                type: result.step,
                actions: result.actions,
                data: result.data
            });

            const updatedContext = {
                ...JSON.parse(session.context || '{}'),
                workflowState: agent.workflowState
            };

            db.prepare(`
                UPDATE clawbot_sessions 
                SET messages = ?, context = ?, last_activity_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `).run(
                JSON.stringify(messages.slice(-50)),
                JSON.stringify(updatedContext),
                session.id
            );
        }

        res.json({
            success: result.success,
            data: {
                step: result.step,
                message: result.message,
                article: result.data,
                actions: result.actions
            }
        });
    } catch (err) {
        console.error('Generate article error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to generate article: ' + err.message
        });
    }
});

/**
 * Generate featured image
 */
router.post('/workflow/image', authenticateToken, async (req, res) => {
    try {
        const { keyword, title, sessionKey } = req.body;

        if (!keyword || !title) {
            return res.status(400).json({
                success: false,
                error: 'Keyword and title are required'
            });
        }

        const session = sessionKey ? 
            db.prepare('SELECT * FROM clawbot_sessions WHERE session_key = ? AND user_id = ?').get(sessionKey, req.user.id) : 
            null;

        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        if (session?.context) {
            const context = JSON.parse(session.context);
            if (context.workflowState) {
                agent.workflowState = context.workflowState;
            }
        }

        const result = await agent.generateFeaturedImage(keyword, title);

        res.json({
            success: result.success,
            data: {
                step: result.step,
                message: result.message,
                image: result.data ? {
                    mimeType: result.data.mimeType,
                    filename: result.data.filename
                } : null,
                actions: result.actions
            }
        });
    } catch (err) {
        console.error('Generate image error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to generate image: ' + err.message
        });
    }
});

/**
 * Publish article to WordPress
 */
router.post('/workflow/publish', authenticateToken, async (req, res) => {
    try {
        const { articleId, sessionKey } = req.body;

        if (!articleId) {
            return res.status(400).json({
                success: false,
                error: 'Article ID is required'
            });
        }

        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        const result = await agent.publishToWordPress(articleId);

        // Update session if exists
        if (sessionKey) {
            const session = db.prepare('SELECT * FROM clawbot_sessions WHERE session_key = ? AND user_id = ?')
                .get(sessionKey, req.user.id);
            
            if (session) {
                const messages = JSON.parse(session.messages || '[]');
                messages.push({
                    role: 'assistant',
                    content: result.message,
                    timestamp: new Date().toISOString(),
                    type: 'published',
                    data: result.data
                });

                db.prepare(`
                    UPDATE clawbot_sessions 
                    SET messages = ?, last_activity_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `).run(JSON.stringify(messages.slice(-50)), session.id);
            }
        }

        res.json({
            success: result.success,
            data: {
                step: result.step,
                message: result.message,
                wpUrl: result.data?.wpUrl,
                wpPostId: result.data?.wpPostId
            }
        });
    } catch (err) {
        console.error('Publish error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to publish: ' + err.message
        });
    }
});

/**
 * Get content ideas
 */
router.get('/ideas', authenticateToken, async (req, res) => {
    try {
        const { keyword } = req.query;

        const agent = new SummonAgent(req.user.id);
        await agent.initialize();

        const result = await agent.getContentIdeas(keyword);

        res.json({
            success: result.success,
            data: {
                ideas: result.data,
                message: result.message
            }
        });
    } catch (err) {
        console.error('Get ideas error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get content ideas'
        });
    }
});

/**
 * SPREADSHEET ROUTES
 * Google Sheets integration for command center functionality
 */

/**
 * Check spreadsheet for new topics to process
 * GET /api/clawbot/spreadsheet/check
 */
router.get('/spreadsheet/check', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetId, sheetName } = req.query;

        const spreadsheetAgent = new SpreadsheetAgent(req.user.id);
        const result = await spreadsheetAgent.checkForNewTopics(spreadsheetId, sheetName);

        res.json(result);
    } catch (err) {
        console.error('Spreadsheet check error:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Failed to check spreadsheet'
        });
    }
});

/**
 * Process a specific row from the spreadsheet
 * POST /api/clawbot/spreadsheet/process-row
 */
router.post('/spreadsheet/process-row', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetId, sheetName, rowIndex, options } = req.body;

        if (!rowIndex) {
            return res.status(400).json({
                success: false,
                error: 'Row index is required'
            });
        }

        const spreadsheetAgent = new SpreadsheetAgent(req.user.id);
        const result = await spreadsheetAgent.processRow(
            spreadsheetId, 
            sheetName || 'Sheet1', 
            parseInt(rowIndex), 
            options || {}
        );

        res.json(result);
    } catch (err) {
        console.error('Process row error:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Failed to process row'
        });
    }
});

/**
 * Process all pending rows
 * POST /api/clawbot/spreadsheet/process-all
 */
router.post('/spreadsheet/process-all', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetId, sheetName, options } = req.body;

        const spreadsheetAgent = new SpreadsheetAgent(req.user.id);
        const result = await spreadsheetAgent.processAllPending(
            spreadsheetId, 
            sheetName || 'Sheet1', 
            options || {}
        );

        res.json(result);
    } catch (err) {
        console.error('Process all pending error:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Failed to process pending rows'
        });
    }
});

/**
 * Update spreadsheet status for a row
 * POST /api/clawbot/spreadsheet/update-status
 */
router.post('/spreadsheet/update-status', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetId, sheetName, rowIndex, status, metadata } = req.body;

        if (!rowIndex || !status) {
            return res.status(400).json({
                success: false,
                error: 'Row index and status are required'
            });
        }

        const spreadsheetAgent = new SpreadsheetAgent(req.user.id);
        const result = await spreadsheetAgent.updateSpreadsheetStatus(
            spreadsheetId,
            sheetName || 'Sheet1',
            parseInt(rowIndex),
            status,
            metadata || {}
        );

        res.json(result);
    } catch (err) {
        console.error('Update spreadsheet status error:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Failed to update spreadsheet status'
        });
    }
});

/**
 * Get spreadsheet info and preview
 * GET /api/clawbot/spreadsheet/info
 */
router.get('/spreadsheet/info', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetId } = req.query;

        const spreadsheetAgent = new SpreadsheetAgent(req.user.id);
        const result = await spreadsheetAgent.getSpreadsheetInfo(spreadsheetId);

        res.json(result);
    } catch (err) {
        console.error('Get spreadsheet info error:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Failed to get spreadsheet info'
        });
    }
});

/**
 * Create a template spreadsheet
 * POST /api/clawbot/spreadsheet/create-template
 */
router.post('/spreadsheet/create-template', authenticateToken, async (req, res) => {
    try {
        const { title } = req.body;

        const spreadsheetAgent = new SpreadsheetAgent(req.user.id);
        const result = await spreadsheetAgent.createTemplateSpreadsheet(title);

        res.json(result);
    } catch (err) {
        console.error('Create template spreadsheet error:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Failed to create template spreadsheet'
        });
    }
});

/**
 * Clear chat history
 */
router.delete('/session/:sessionKey', authenticateToken, (req, res) => {
    try {
        const result = db.prepare(`
            DELETE FROM clawbot_sessions WHERE session_key = ? AND user_id = ?
        `).run(req.params.sessionKey, req.user.id);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        res.json({
            success: true,
            message: 'Chat history cleared'
        });
    } catch (err) {
        console.error('Clear session error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to clear chat history'
        });
    }
});

// Helper functions

async function getOrCreateSession(sessionKey, userId) {
    let session;
    
    if (sessionKey) {
        session = db.prepare('SELECT * FROM clawbot_sessions WHERE session_key = ? AND user_id = ?')
            .get(sessionKey, userId);
    }

    if (!session) {
        const newSessionKey = uuidv4();
        const initialContext = buildInitialContext(userId);
        
        const result = db.prepare(`
            INSERT INTO clawbot_sessions (user_id, session_key, messages, context)
            VALUES (?, ?, ?, ?)
        `).run(
            userId,
            newSessionKey,
            JSON.stringify([]),
            JSON.stringify(initialContext)
        );

        session = db.prepare('SELECT * FROM clawbot_sessions WHERE id = ?').get(result.lastInsertRowid);
    }

    return session;
}

function buildInitialContext(userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const businessProfile = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(userId);
    const connections = db.prepare('SELECT type, status FROM connections WHERE user_id = ?').all(userId);
    const articleCount = db.prepare('SELECT COUNT(*) as count FROM articles WHERE user_id = ?').get(userId);

    const creditsAvailable = user?.tier === 'pro' 
        ? 'unlimited' 
        : Math.max(0, (user?.credits_included || 0) - (user?.credits_used || 0));

    return {
        userTier: user?.tier || 'free',
        creditsAvailable,
        creditsUsed: user?.credits_used || 0,
        businessProfileComplete: !!(businessProfile?.company_name && businessProfile?.industry),
        connections: connections || [],
        articleCount: articleCount?.count || 0,
        onboardingComplete: !!(businessProfile?.company_name && connections.length > 0),
        userName: user?.name
    };
}

module.exports = router;