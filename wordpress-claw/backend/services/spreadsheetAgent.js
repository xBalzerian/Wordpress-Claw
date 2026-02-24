/**
 * Spreadsheet Agent Service
 * Integrates Google Sheets with ClawBot for automated content workflows
 * The spreadsheet is the COMMAND CENTER for content operations
 */

const GoogleSheetsService = require('./googleSheets');
const SummonAgent = require('./summonAgent');
const db = require('../database/db');

class SpreadsheetAgent {
    constructor(userId) {
        this.userId = userId;
        this.sheetsService = null;
        this.summonAgent = null;
        this.connection = null;
    }

    /**
     * Initialize the spreadsheet agent
     */
    async initialize() {
        // Get user's Google Sheets connection
        this.connection = await db.prepare(`
            SELECT * FROM connections 
            WHERE user_id = ? AND type = ? AND status = ?
        `).get(this.userId, 'googlesheets', 'active');

        if (!this.connection) {
            throw new Error('No active Google Sheets connection found. Please connect your Google Sheets first.');
        }

        // Initialize Google Sheets service
        const credentials = JSON.parse(this.connection.credentials);
        const config = this.connection.config ? JSON.parse(this.connection.config) : {};
        
        this.sheetsService = new GoogleSheetsService(credentials);
        await this.sheetsService.initialize();

        // Initialize SummonAgent for content generation
        this.summonAgent = new SummonAgent(this.userId);
        await this.summonAgent.initialize();

        this.config = config;
        return true;
    }

    /**
     * Check spreadsheet for new topics to process
     * Main entry point for automated workflow
     */
    async checkForNewTopics(spreadsheetId = null, sheetName = null) {
        try {
            if (!this.sheetsService) await this.initialize();

            const targetSpreadsheetId = spreadsheetId || this.config.spreadsheetId;
            const targetSheetName = sheetName || this.config.sheetName || 'Sheet1';

            if (!targetSpreadsheetId) {
                return {
                    success: false,
                    error: 'No spreadsheet ID configured. Please set up your spreadsheet connection.'
                };
            }

            // Read the spreadsheet
            const sheetData = await this.sheetsService.readSheet(targetSpreadsheetId, targetSheetName);
            
            if (!sheetData.success) {
                return sheetData;
            }

            // Find pending rows
            const pendingRows = this.sheetsService.findPendingRows(sheetData.data, 'status');

            return {
                success: true,
                message: `Found ${pendingRows.length} pending topic(s) to process`,
                data: {
                    totalRows: sheetData.totalRows,
                    pendingCount: pendingRows.length,
                    pendingRows: pendingRows.slice(0, 10), // Limit to first 10
                    columns: sheetData.columns,
                    headers: sheetData.headers
                },
                actions: pendingRows.length > 0 ? [
                    {
                        type: 'process_all_pending',
                        label: `Process All ${pendingRows.length} Topics`,
                        params: { spreadsheetId: targetSpreadsheetId, sheetName: targetSheetName }
                    },
                    ...pendingRows.slice(0, 3).map(row => ({
                        type: 'process_row',
                        label: `Process: ${this.getTopicFromRow(row, sheetData.columns)}`,
                        params: { 
                            spreadsheetId: targetSpreadsheetId, 
                            sheetName: targetSheetName,
                            rowIndex: row._rowIndex 
                        }
                    }))
                ] : []
            };
        } catch (err) {
            console.error('Check for new topics error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Process a specific row from the spreadsheet
     */
    async processRow(spreadsheetId, sheetName, rowIndex, options = {}) {
        try {
            if (!this.sheetsService) await this.initialize();

            // Read current data
            const sheetData = await this.sheetsService.readSheet(spreadsheetId, sheetName);
            
            if (!sheetData.success) {
                return sheetData;
            }

            // Find the row
            const row = sheetData.data.find(r => r._rowIndex === rowIndex);
            if (!row) {
                return {
                    success: false,
                    error: `Row ${rowIndex} not found in spreadsheet`
                };
            }

            // Extract topic/keyword from row
            const topic = this.getTopicFromRow(row, sheetData.columns);
            if (!topic) {
                return {
                    success: false,
                    error: 'No topic/keyword found in this row'
                };
            }

            // Update status to PROCESSING
            await this.sheetsService.updateRowStatus(
                spreadsheetId,
                rowIndex,
                'PROCESSING',
                { notes: 'ClawBot is working on this...' },
                sheetName,
                sheetData.headers
            );

            // Start content workflow
            const workflowResult = await this.summonAgent.startContentWorkflow(topic, options);

            if (!workflowResult.success) {
                // Update status to ERROR
                await this.sheetsService.updateRowStatus(
                    spreadsheetId,
                    rowIndex,
                    'ERROR',
                    { notes: workflowResult.error || 'Failed to research topic' },
                    sheetName,
                    sheetData.headers
                );
                return workflowResult;
            }

            // Generate the article
            const generateResult = await this.summonAgent.generateArticle(topic, options);

            if (!generateResult.success) {
                await this.sheetsService.updateRowStatus(
                    spreadsheetId,
                    rowIndex,
                    'ERROR',
                    { notes: generateResult.error || 'Failed to generate article' },
                    sheetName,
                    sheetData.headers
                );
                return generateResult;
            }

            // Save the article
            const articleData = generateResult.data;
            const saveResult = await this.summonAgent.saveArticle(articleData);

            if (!saveResult.success) {
                await this.sheetsService.updateRowStatus(
                    spreadsheetId,
                    rowIndex,
                    'ERROR',
                    { notes: saveResult.error || 'Failed to save article' },
                    sheetName,
                    sheetData.headers
                );
                return saveResult;
            }

            // Update status to DONE with article URL
            const articleId = saveResult.articleId;
            const articleUrl = `${process.env.FRONTEND_URL || ''}/dashboard/articles.html?id=${articleId}`;

            await this.sheetsService.updateRowStatus(
                spreadsheetId,
                rowIndex,
                'DONE',
                { 
                    url: articleUrl,
                    notes: `Article created: ${articleData.title}`
                },
                sheetName,
                sheetData.headers
            );

            return {
                success: true,
                message: `Successfully processed "${topic}"`,
                data: {
                    topic,
                    articleId,
                    articleUrl,
                    title: articleData.title,
                    rowIndex
                },
                actions: [
                    {
                        type: 'view_article',
                        label: 'View Article',
                        params: { articleId }
                    },
                    {
                        type: 'publish_article',
                        label: 'Publish to WordPress',
                        params: { articleId }
                    }
                ]
            };
        } catch (err) {
            console.error('Process row error:', err);
            
            // Try to update status to ERROR
            try {
                await this.sheetsService.updateRowStatus(
                    spreadsheetId,
                    rowIndex,
                    'ERROR',
                    { notes: err.message },
                    sheetName,
                    []
                );
            } catch (updateErr) {
                console.error('Failed to update error status:', updateErr);
            }

            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Process all pending rows
     */
    async processAllPending(spreadsheetId, sheetName, options = {}) {
        try {
            if (!this.sheetsService) await this.initialize();

            // Check for pending topics
            const checkResult = await this.checkForNewTopics(spreadsheetId, sheetName);
            
            if (!checkResult.success) {
                return checkResult;
            }

            const pendingRows = checkResult.data.pendingRows;
            
            if (pendingRows.length === 0) {
                return {
                    success: true,
                    message: 'No pending topics to process',
                    data: { processed: 0, results: [] }
                };
            }

            const results = [];
            const errors = [];

            // Process each pending row
            for (const row of pendingRows) {
                const result = await this.processRow(spreadsheetId, sheetName, row._rowIndex, options);
                if (result.success) {
                    results.push(result.data);
                } else {
                    errors.push({ rowIndex: row._rowIndex, error: result.error });
                }
            }

            return {
                success: true,
                message: `Processed ${results.length} topic(s)${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
                data: {
                    processed: results.length,
                    failed: errors.length,
                    results,
                    errors
                }
            };
        } catch (err) {
            console.error('Process all pending error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Update spreadsheet status for a row
     */
    async updateSpreadsheetStatus(spreadsheetId, sheetName, rowIndex, status, metadata = {}) {
        try {
            if (!this.sheetsService) await this.initialize();

            const sheetData = await this.sheetsService.readSheet(spreadsheetId, sheetName);
            
            const result = await this.sheetsService.updateRowStatus(
                spreadsheetId,
                rowIndex,
                status,
                metadata,
                sheetName,
                sheetData.headers
            );

            return {
                success: true,
                message: `Updated row ${rowIndex} status to ${status}`,
                data: result
            };
        } catch (err) {
            console.error('Update spreadsheet status error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Get topic/keyword from row using detected columns
     */
    getTopicFromRow(row, columns) {
        // Try common topic column names
        const topicKeys = ['topic', 'keyword', 'subject', 'title', 'query', 'theme', 'idea'];
        
        for (const key of topicKeys) {
            if (row[key] && row[key].toString().trim()) {
                return row[key].toString().trim();
            }
        }

        // If no topic column found, use the second column (usually the content column)
        const keys = Object.keys(row).filter(k => !k.startsWith('_'));
        if (keys.length > 1) {
            return row[keys[1]];
        }

        return null;
    }

    /**
     * Create a template spreadsheet for the user
     */
    async createTemplateSpreadsheet(title = 'WordPress Claw - Content Calendar') {
        try {
            if (!this.sheetsService) await this.initialize();

            const result = await this.sheetsService.createSpreadsheet(title, ['Topics', 'Published']);
            
            if (!result.success) {
                return result;
            }

            // Add headers to the Topics sheet
            const headers = [
                ['Status', 'Topic/Keyword', 'Priority', 'Assigned To', 'Notes', 'Article URL', 'Created', 'Updated']
            ];

            await this.sheetsService.appendRows(result.spreadsheetId, headers, 'Topics');

            // Add some example rows
            const examples = [
                ['PENDING', 'Best coffee shops in Manila', 'High', '', 'Focus on specialty cafes', '', new Date().toISOString(), ''],
                ['PENDING', 'SEO tips for small businesses', 'Medium', '', '', '', new Date().toISOString(), ''],
                ['PENDING', 'Digital marketing trends 2024', 'High', '', 'Include AI tools section', '', new Date().toISOString(), '']
            ];

            await this.sheetsService.appendRows(result.spreadsheetId, examples, 'Topics');

            // Update connection config with new spreadsheet ID
            if (this.connection) {
                const config = this.connection.config ? JSON.parse(this.connection.config) : {};
                config.spreadsheetId = result.spreadsheetId;
                config.sheetName = 'Topics';
                
                await db.prepare(`
                    UPDATE connections 
                    SET config = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE id = ?
                `).run(JSON.stringify(config), this.connection.id);
            }

            return {
                success: true,
                message: 'Template spreadsheet created successfully',
                data: {
                    spreadsheetId: result.spreadsheetId,
                    spreadsheetUrl: result.spreadsheetUrl,
                    title
                }
            };
        } catch (err) {
            console.error('Create template spreadsheet error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Get spreadsheet info and preview
     */
    async getSpreadsheetInfo(spreadsheetId = null) {
        try {
            if (!this.sheetsService) await this.initialize();

            const targetSpreadsheetId = spreadsheetId || this.config.spreadsheetId;

            if (!targetSpreadsheetId) {
                return {
                    success: false,
                    error: 'No spreadsheet ID configured'
                };
            }

            // Get spreadsheet metadata
            const testResult = await this.sheetsService.testConnection(targetSpreadsheetId);
            
            if (!testResult.success) {
                return testResult;
            }

            // Read first few rows for preview
            const sheetData = await this.sheetsService.readSheet(targetSpreadsheetId, this.config.sheetName || 'Sheet1');

            return {
                success: true,
                data: {
                    title: testResult.data.title,
                    sheets: testResult.data.sheets,
                    spreadsheetId: targetSpreadsheetId,
                    headers: sheetData.headers,
                    preview: sheetData.data.slice(0, 5),
                    totalRows: sheetData.totalRows,
                    columns: sheetData.columns
                }
            };
        } catch (err) {
            console.error('Get spreadsheet info error:', err);
            return {
                success: false,
                error: err.message
            };
        }
    }
}

module.exports = SpreadsheetAgent;
