/**
 * Spreadsheet Agent Service - Updated Version
 * Uses Google Service Account for full read/write access
 * The spreadsheet is the COMMAND CENTER for content operations
 */

const googleSheetsService = require('./googleSheetsService');
const SummonAgent = require('./summonAgent');
const db = require('../database/db');

class SpreadsheetAgent {
    constructor(userId) {
        this.userId = userId;
        this.summonAgent = null;
        this.connection = null;
    }

    /**
     * Initialize the spreadsheet agent
     */
    async initialize() {
        // Initialize Google Sheets service
        await googleSheetsService.initialize();

        // Initialize SummonAgent for content generation
        this.summonAgent = new SummonAgent(this.userId);
        await this.summonAgent.initialize();

        // Get user's Google Sheets connection
        this.connection = await db.prepare(`
            SELECT * FROM connections 
            WHERE user_id = ? AND type = ? AND status = ?
        `).get(this.userId, 'googlesheets', 'active');

        return true;
    }

    /**
     * Get connection info for user
     */
    async getConnectionInfo() {
        const serviceAccountEmail = googleSheetsService.getServiceAccountEmail();
        
        return {
            success: true,
            data: {
                serviceAccountEmail,
                instructions: [
                    'Open your Google Sheet',
                    'Click "Share" in the top right',
                    `Add this email: ${serviceAccountEmail}`,
                    'Set permission to "Editor"',
                    'Click "Send"'
                ]
            }
        };
    }

    /**
     * Check spreadsheet for new topics to process
     */
    async checkForNewTopics(spreadsheetId = null, sheetName = null) {
        try {
            await this.initialize();

            // Get spreadsheet ID from connection if not provided
            let targetSpreadsheetId = spreadsheetId;
            if (!targetSpreadsheetId && this.connection) {
                const credentials = JSON.parse(this.connection.credentials || '{}');
                targetSpreadsheetId = googleSheetsService.constructor.extractSpreadsheetId(
                    credentials.spreadsheetUrl
                );
            }

            const targetSheetName = sheetName || 'Sheet1';

            if (!targetSpreadsheetId) {
                return {
                    success: false,
                    error: 'No spreadsheet ID configured. Please connect your Google Sheet first.',
                    needsSetup: true
                };
            }

            // Test connection first
            const testResult = await googleSheetsService.testConnection(targetSpreadsheetId);
            if (!testResult.success) {
                return {
                    ...testResult,
                    needsSetup: true,
                    setupInstructions: await this.getConnectionInfo()
                };
            }

            // Read the spreadsheet
            const sheetData = await googleSheetsService.readSheet(targetSpreadsheetId, targetSheetName);
            
            if (!sheetData.success) {
                return sheetData;
            }

            // Find pending rows
            const pendingRows = googleSheetsService.findPendingRows(sheetData.data, 'status');

            return {
                success: true,
                message: `Found ${pendingRows.length} pending topic(s) to process`,
                data: {
                    spreadsheetTitle: testResult.data.title,
                    totalRows: sheetData.totalRows,
                    pendingCount: pendingRows.length,
                    pendingRows: pendingRows.slice(0, 10),
                    headers: sheetData.headers
                },
                actions: pendingRows.length > 0 ? [
                    {
                        type: 'process_all_pending',
                        label: `⚡ Process All ${pendingRows.length} Topics`,
                        params: { spreadsheetId: targetSpreadsheetId, sheetName: targetSheetName }
                    },
                    ...pendingRows.slice(0, 3).map(row => ({
                        type: 'process_row',
                        label: `Process: ${this.getTopicFromRow(row)}`,
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
            await this.initialize();

            // Read current data
            const sheetData = await googleSheetsService.readSheet(spreadsheetId, sheetName);
            
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
            const topic = this.getTopicFromRow(row);
            if (!topic) {
                return {
                    success: false,
                    error: 'No topic/keyword found in this row'
                };
            }

            // Update status to PROCESSING
            await googleSheetsService.updateRowColumns(
                spreadsheetId,
                sheetName,
                rowIndex,
                sheetData.headers,
                { status: 'PROCESSING', notes: 'ClawBot is working on this...' }
            );

            // Start content workflow
            const workflowResult = await this.summonAgent.startContentWorkflow(topic, options);

            if (!workflowResult.success) {
                await googleSheetsService.updateRowColumns(
                    spreadsheetId,
                    sheetName,
                    rowIndex,
                    sheetData.headers,
                    { status: 'ERROR', notes: workflowResult.error || 'Failed to research topic' }
                );
                return workflowResult;
            }

            // Generate the article
            const generateResult = await this.summonAgent.generateArticle(topic, options);

            if (!generateResult.success) {
                await googleSheetsService.updateRowColumns(
                    spreadsheetId,
                    sheetName,
                    rowIndex,
                    sheetData.headers,
                    { status: 'ERROR', notes: generateResult.error || 'Failed to generate article' }
                );
                return generateResult;
            }

            // Save the article
            const articleData = generateResult.data;
            const saveResult = await this.summonAgent.saveArticle(articleData);

            if (!saveResult.success) {
                await googleSheetsService.updateRowColumns(
                    spreadsheetId,
                    sheetName,
                    rowIndex,
                    sheetData.headers,
                    { status: 'ERROR', notes: saveResult.error || 'Failed to save article' }
                );
                return saveResult;
            }

            // Update status to DONE with article URL
            const articleId = saveResult.articleId;
            const articleUrl = `${process.env.FRONTEND_URL || ''}/dashboard/articles.html?id=${articleId}`;

            await googleSheetsService.updateRowColumns(
                spreadsheetId,
                sheetName,
                rowIndex,
                sheetData.headers,
                { 
                    status: 'DONE',
                    wp_post_url: articleUrl,
                    notes: `Article created: ${articleData.title}`
                }
            );

            return {
                success: true,
                message: `✅ Successfully processed "${topic}"`,
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
                const sheetData = await googleSheetsService.readSheet(spreadsheetId, sheetName);
                if (sheetData.success) {
                    await googleSheetsService.updateRowColumns(
                        spreadsheetId,
                        sheetName,
                        rowIndex,
                        sheetData.headers,
                        { status: 'ERROR', notes: err.message }
                    );
                }
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
            await this.initialize();

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
                
                // Small delay between rows to avoid rate limiting
                if (pendingRows.length > 1) {
                    await new Promise(r => setTimeout(r, 1000));
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
     * Get topic/keyword from row
     */
    getTopicFromRow(row) {
        // Try common topic column names
        const topicKeys = ['main_keyword', 'keyword', 'topic', 'subject', 'title', 'query', 'theme', 'idea'];
        
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
     * Get spreadsheet info and preview
     */
    async getSpreadsheetInfo(spreadsheetId = null) {
        try {
            await this.initialize();

            // Get spreadsheet ID from connection if not provided
            let targetSpreadsheetId = spreadsheetId;
            if (!targetSpreadsheetId && this.connection) {
                const credentials = JSON.parse(this.connection.credentials || '{}');
                targetSpreadsheetId = googleSheetsService.constructor.extractSpreadsheetId(
                    credentials.spreadsheetUrl
                );
            }

            if (!targetSpreadsheetId) {
                return {
                    success: false,
                    error: 'No spreadsheet ID configured'
                };
            }

            // Test connection
            const testResult = await googleSheetsService.testConnection(targetSpreadsheetId);
            
            if (!testResult.success) {
                return {
                    ...testResult,
                    needsSetup: true,
                    setupInstructions: await this.getConnectionInfo()
                };
            }

            // Read first sheet
            const sheetData = await googleSheetsService.readSheet(
                targetSpreadsheetId, 
                testResult.data.sheets[0]?.title || 'Sheet1'
            );

            // Calculate stats
            let pending = 0, processing = 0, done = 0, error = 0;

            if (sheetData.success) {
                const statusHeader = sheetData.headers.find(h =
                    h.toLowerCase().includes('status')
                );
                const statusKey = statusHeader ? 
                    googleSheetsService.sanitizeColumnName(statusHeader) : null;

                sheetData.data.forEach(row => {
                    const status = (statusKey ? row[statusKey] : '').toString().toLowerCase();
                    
                    if (status.includes('done') || status.includes('complete')) done++;
                    else if (status.includes('process')) processing++;
                    else if (status.includes('error') || status.includes('fail')) error++;
                    else pending++;
                });
            }

            return {
                success: true,
                data: {
                    title: testResult.data.title,
                    sheets: testResult.data.sheets,
                    spreadsheetId: targetSpreadsheetId,
                    headers: sheetData.headers,
                    preview: sheetData.data?.slice(0, 5),
                    totalRows: sheetData.totalRows,
                    stats: { pending, processing, done, error }
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

    /**
     * Create a template spreadsheet for the user
     */
    async createTemplateSpreadsheet(title = 'WordPress Claw - Content Calendar') {
        try {
            await this.initialize();

            const result = await googleSheetsService.createSpreadsheet(title, ['Topics']);
            
            if (!result.success) {
                return result;
            }

            // Add headers to the Topics sheet
            const headers = [
                ['Status', 'Main Keyword', 'Priority', 'Notes', 'WP Post URL', 'Created']
            ];

            await googleSheetsService.appendRows(
                result.data.spreadsheetId,
                'Topics',
                headers
            );

            // Add example rows
            const examples = [
                ['PENDING', 'Best coffee shops in Manila', 'High', 'Focus on specialty cafes', '', new Date().toISOString()],
                ['PENDING', 'SEO tips for small businesses', 'Medium', '', '', new Date().toISOString()],
                ['PENDING', 'Digital marketing trends 2024', 'High', 'Include AI tools section', '', new Date().toISOString()]
            ];

            await googleSheetsService.appendRows(
                result.data.spreadsheetId,
                'Topics',
                examples
            );

            return {
                success: true,
                message: 'Template spreadsheet created successfully',
                data: {
                    spreadsheetId: result.data.spreadsheetId,
                    spreadsheetUrl: result.data.spreadsheetUrl,
                    title,
                    setupInstructions: await this.getConnectionInfo()
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
}

module.exports = SpreadsheetAgent;
