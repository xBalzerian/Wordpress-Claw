/**
 * Google Sheets Routes - Service Account Version
 * Simple, reliable Google Sheets integration
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const googleSheetsService = require('../services/googleSheetsService');
const SpreadsheetAgent = require('../services/spreadsheetAgent');
const db = require('../database/db');

/**
 * GET /api/sheets/setup-info
 * Get setup instructions for user
 */
router.get('/setup-info', authenticateToken, async (req, res) => {
    try {
        const serviceAccountEmail = googleSheetsService.getServiceAccountEmail();
        
        if (!serviceAccountEmail) {
            return res.status(500).json({
                success: false,
                error: 'Google Sheets service not configured. Please contact support.'
            });
        }

        res.json({
            success: true,
            data: {
                serviceAccountEmail,
                instructions: [
                    'Open your Google Sheet',
                    'Click "Share" in the top right corner',
                    `Add this email as an Editor: ${serviceAccountEmail}`,
                    'Click "Send" or "Share"',
                    'Paste your spreadsheet URL below'
                ],
                note: 'Your spreadsheet must be shared with Editor access for ClawBot to update statuses.'
            }
        });
    } catch (err) {
        console.error('Setup info error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get setup information'
        });
    }
});

/**
 * POST /api/sheets/connect
 * Connect a Google Sheet by URL
 */
router.post('/connect', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetUrl, sheetName = 'Sheet1' } = req.body;

        if (!spreadsheetUrl) {
            return res.status(400).json({
                success: false,
                error: 'Spreadsheet URL is required'
            });
        }

        // Extract spreadsheet ID
        const spreadsheetId = googleSheetsService.constructor.extractSpreadsheetId(spreadsheetUrl);
        
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Google Sheets URL. Please check and try again.'
            });
        }

        // Test the connection
        const testResult = await googleSheetsService.testConnection(spreadsheetId);
        
        if (!testResult.success) {
            const serviceAccountEmail = googleSheetsService.getServiceAccountEmail();
            return res.status(403).json({
                success: false,
                error: testResult.error,
                needsSetup: true,
                data: {
                    serviceAccountEmail,
                    instructions: [
                        'Open your Google Sheet',
                        'Click "Share" in the top right',
                        `Add: ${serviceAccountEmail}`,
                        'Set permission to "Editor"',
                        'Click "Send"'
                    ]
                }
            });
        }

        // Save connection to database
        const credentials = JSON.stringify({ spreadsheetUrl, spreadsheetId });
        const config = JSON.stringify({ sheetName });

        // Check if connection already exists
        const existing = await db.prepare(`
            SELECT id FROM connections 
            WHERE user_id = ? AND type = 'googlesheets'
        `).get(req.user.id);

        if (existing) {
            await db.prepare(`
                UPDATE connections 
                SET credentials = ?, config = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(credentials, config, existing.id);
        } else {
            await db.prepare(`
                INSERT INTO connections (user_id, type, name, credentials, config, status)
                VALUES (?, 'googlesheets', 'Google Sheets', ?, ?, 'active')
            `).run(req.user.id, credentials, config);
        }

        res.json({
            success: true,
            message: 'Google Sheet connected successfully',
            data: {
                spreadsheetId,
                title: testResult.data.title,
                sheets: testResult.data.sheets
            }
        });
    } catch (err) {
        console.error('Connect sheet error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to connect spreadsheet: ' + err.message
        });
    }
});

/**
 * GET /api/sheets/status
 * Check connection status
 */
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const connection = await db.prepare(`
            SELECT * FROM connections 
            WHERE user_id = ? AND type = 'googlesheets' AND status = 'active'
        `).get(req.user.id);

        if (!connection) {
            return res.json({
                success: true,
                data: {
                    connected: false,
                    message: 'No Google Sheet connected'
                }
            });
        }

        const credentials = JSON.parse(connection.credentials);
        const testResult = await googleSheetsService.testConnection(credentials.spreadsheetId);

        res.json({
            success: true,
            data: {
                connected: testResult.success,
                spreadsheetId: credentials.spreadsheetId,
                spreadsheetUrl: credentials.spreadsheetUrl,
                title: testResult.data?.title,
                error: testResult.success ? null : testResult.error
            }
        });
    } catch (err) {
        console.error('Status error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to check status'
        });
    }
});

/**
 * GET /api/sheets/data
 * Read spreadsheet data
 */
router.get('/data', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetId, sheetName = 'Sheet1' } = req.query;

        let targetSpreadsheetId = spreadsheetId;
        let targetSheetName = sheetName;

        // If no spreadsheetId provided, get from user's connection
        if (!targetSpreadsheetId) {
            const connection = await db.prepare(`
                SELECT * FROM connections 
                WHERE user_id = ? AND type = 'googlesheets' AND status = 'active'
            `).get(req.user.id);

            if (!connection) {
                return res.status(404).json({
                    success: false,
                    error: 'No Google Sheet connected. Please connect a sheet first.'
                });
            }

            const credentials = JSON.parse(connection.credentials);
            const config = JSON.parse(connection.config || '{}');
            targetSpreadsheetId = credentials.spreadsheetId;
            targetSheetName = config.sheetName || 'Sheet1';
        }

        const result = await googleSheetsService.readSheet(targetSpreadsheetId, targetSheetName);
        res.json(result);
    } catch (err) {
        console.error('Read data error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to read spreadsheet data'
        });
    }
});

/**
 * POST /api/sheets/update-row
 * Update a specific row
 */
router.post('/update-row', authenticateToken, async (req, res) => {
    try {
        const { rowIndex, updates } = req.body;

        if (!rowIndex || !updates) {
            return res.status(400).json({
                success: false,
                error: 'rowIndex and updates are required'
            });
        }

        const connection = await db.prepare(`
            SELECT * FROM connections 
            WHERE user_id = ? AND type = 'googlesheets' AND status = 'active'
        `).get(req.user.id);

        if (!connection) {
            return res.status(404).json({
                success: false,
                error: 'No Google Sheet connected'
            });
        }

        const credentials = JSON.parse(connection.credentials);
        const config = JSON.parse(connection.config || '{}');

        // First read to get headers
        const sheetData = await googleSheetsService.readSheet(
            credentials.spreadsheetId,
            config.sheetName || 'Sheet1'
        );

        if (!sheetData.success) {
            return res.status(400).json(sheetData);
        }

        const result = await googleSheetsService.updateRowColumns(
            credentials.spreadsheetId,
            config.sheetName || 'Sheet1',
            rowIndex,
            sheetData.headers,
            updates
        );

        res.json(result);
    } catch (err) {
        console.error('Update row error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update row'
        });
    }
});

/**
 * POST /api/sheets/clawbot/check
 * ClawBot: Check for new topics
 */
router.post('/clawbot/check', authenticateToken, async (req, res) => {
    try {
        const agent = new SpreadsheetAgent(req.user.id);
        const result = await agent.checkForNewTopics();
        res.json(result);
    } catch (err) {
        console.error('ClawBot check error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /api/sheets/clawbot/process-row
 * ClawBot: Process a specific row
 */
router.post('/clawbot/process-row', authenticateToken, async (req, res) => {
    try {
        const { rowIndex } = req.body;

        if (!rowIndex) {
            return res.status(400).json({
                success: false,
                error: 'rowIndex is required'
            });
        }

        const connection = await db.prepare(`
            SELECT * FROM connections 
            WHERE user_id = ? AND type = 'googlesheets' AND status = 'active'
        `).get(req.user.id);

        if (!connection) {
            return res.status(404).json({
                success: false,
                error: 'No Google Sheet connected'
            });
        }

        const credentials = JSON.parse(connection.credentials);
        const config = JSON.parse(connection.config || '{}');

        const agent = new SpreadsheetAgent(req.user.id);
        const result = await agent.processRow(
            credentials.spreadsheetId,
            config.sheetName || 'Sheet1',
            parseInt(rowIndex)
        );

        res.json(result);
    } catch (err) {
        console.error('Process row error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /api/sheets/clawbot/process-all
 * ClawBot: Process all pending rows
 */
router.post('/clawbot/process-all', authenticateToken, async (req, res) => {
    try {
        const connection = await db.prepare(`
            SELECT * FROM connections 
            WHERE user_id = ? AND type = 'googlesheets' AND status = 'active'
        `).get(req.user.id);

        if (!connection) {
            return res.status(404).json({
                success: false,
                error: 'No Google Sheet connected'
            });
        }

        const credentials = JSON.parse(connection.credentials);
        const config = JSON.parse(connection.config || '{}');

        const agent = new SpreadsheetAgent(req.user.id);
        const result = await agent.processAllPending(
            credentials.spreadsheetId,
            config.sheetName || 'Sheet1'
        );

        res.json(result);
    } catch (err) {
        console.error('Process all error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/**
 * POST /api/sheets/create-template
 * Create a template spreadsheet
 */
router.post('/create-template', authenticateToken, async (req, res) => {
    try {
        const { title = 'WordPress Claw - Content Calendar' } = req.body;

        const agent = new SpreadsheetAgent(req.user.id);
        const result = await agent.createTemplateSpreadsheet(title);

        // If successful, save the connection
        if (result.success) {
            const credentials = JSON.stringify({
                spreadsheetUrl: result.data.spreadsheetUrl,
                spreadsheetId: result.data.spreadsheetId
            });
            const config = JSON.stringify({ sheetName: 'Topics' });

            const existing = await db.prepare(`
                SELECT id FROM connections 
                WHERE user_id = ? AND type = 'googlesheets'
            `).get(req.user.id);

            if (existing) {
                await db.prepare(`
                    UPDATE connections 
                    SET credentials = ?, config = ?, status = 'active', updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(credentials, config, existing.id);
            } else {
                await db.prepare(`
                    INSERT INTO connections (user_id, type, name, credentials, config, status)
                    VALUES (?, 'googlesheets', 'Google Sheets', ?, ?, 'active')
                `).run(req.user.id, credentials, config);
            }
        }

        res.json(result);
    } catch (err) {
        console.error('Create template error:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

module.exports = router;
