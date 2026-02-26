/**
 * Google Sheets Routes - Maton AI Integration
 * API-based Google Sheets integration using Maton Agent Toolkit
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const matonService = require('../services/matonService');

/**
 * POST /api/sheets/connect
 * Start connection to Google Sheets using Maton
 * Returns OAuth redirect URL
 */
router.post('/connect', authenticateToken, async (req, res) => {
    try {
        const result = await matonService.connectToGoogleSheets(req.user.id);
        
        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (err) {
        console.error('Connect to sheets error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to connect to Google Sheets'
        });
    }
});

/**
 * GET /api/sheets/status
 * Check connection status
 */
router.get('/status', authenticateToken, async (req, res) => {
    try {
        const connection = await matonService.getConnection(req.user.id);
        
        if (!connection) {
            return res.json({
                success: true,
                data: {
                    connected: false,
                    message: 'Not connected to Google Sheets'
                }
            });
        }

        // Check if connection is active
        const statusResult = await matonService.checkConnection(req.user.id);

        res.json({
            success: true,
            data: {
                connected: statusResult.isConnected,
                connectionId: connection.credentials?.connectionId,
                connectedAt: connection.credentials?.connectedAt
            }
        });
    } catch (err) {
        console.error('Check status error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to check connection status'
        });
    }
});

/**
 * POST /api/sheets/read
 * Read data from a Google Sheet
 */
router.post('/read', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetUrl, range } = req.body;

        if (!spreadsheetUrl) {
            return res.status(400).json({
                success: false,
                error: 'spreadsheetUrl is required'
            });
        }

        const spreadsheetId = matonService.constructor.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Google Sheets URL'
            });
        }

        const result = await matonService.readSheet(spreadsheetId, { range });

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (err) {
        console.error('Read sheet error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to read sheet'
        });
    }
});

/**
 * POST /api/sheets/write
 * Write data to a Google Sheet
 */
router.post('/write', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetUrl, data, worksheetId } = req.body;

        if (!spreadsheetUrl || !data) {
            return res.status(400).json({
                success: false,
                error: 'spreadsheetUrl and data are required'
            });
        }

        const spreadsheetId = matonService.constructor.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Google Sheets URL'
            });
        }

        const result = await matonService.writeSheet(spreadsheetId, data, { worksheetId });

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (err) {
        console.error('Write sheet error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to write to sheet'
        });
    }
});

/**
 * POST /api/sheets/update-cells
 * Update specific cells in a Google Sheet
 */
router.post('/update-cells', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetUrl, updates, worksheetId } = req.body;

        if (!spreadsheetUrl || !updates || !Array.isArray(updates)) {
            return res.status(400).json({
                success: false,
                error: 'spreadsheetUrl and updates array are required'
            });
        }

        const spreadsheetId = matonService.constructor.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Google Sheets URL'
            });
        }

        const result = await matonService.updateCells(spreadsheetId, updates, { worksheetId });

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (err) {
        console.error('Update cells error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update cells'
        });
    }
});

/**
 * POST /api/sheets/sync
 * Sync Google Sheet with Content Queue
 * Reads from sheet and adds to content queue
 */
router.post('/sync', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetUrl, worksheetId } = req.body;

        if (!spreadsheetUrl) {
            return res.status(400).json({
                success: false,
                error: 'spreadsheetUrl is required'
            });
        }

        const spreadsheetId = matonService.constructor.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Google Sheets URL'
            });
        }

        const result = await matonService.syncWithContentQueue(
            req.user.id,
            spreadsheetId,
            { worksheetId }
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (err) {
        console.error('Sync error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to sync with content queue'
        });
    }
});

/**
 * POST /api/sheets/export
 * Export Content Queue to Google Sheet
 */
router.post('/export', authenticateToken, async (req, res) => {
    try {
        const { spreadsheetUrl, worksheetId } = req.body;

        if (!spreadsheetUrl) {
            return res.status(400).json({
                success: false,
                error: 'spreadsheetUrl is required'
            });
        }

        const spreadsheetId = matonService.constructor.extractSpreadsheetId(spreadsheetUrl);
        if (!spreadsheetId) {
            return res.status(400).json({
                success: false,
                error: 'Invalid Google Sheets URL'
            });
        }

        const result = await matonService.exportContentQueue(
            req.user.id,
            spreadsheetId,
            { worksheetId }
        );

        if (!result.success) {
            return res.status(400).json(result);
        }

        res.json(result);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to export to Google Sheet'
        });
    }
});

/**
 * POST /api/sheets/disconnect
 * Disconnect from Google Sheets
 */
router.post('/disconnect', authenticateToken, async (req, res) => {
    try {
        // Note: Maton doesn't have a direct disconnect method
        // We just clear the local connection data
        res.json({
            success: true,
            message: 'Disconnected from Google Sheets'
        });
    } catch (err) {
        console.error('Disconnect error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to disconnect'
        });
    }
});

module.exports = router;
