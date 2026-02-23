const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all connections for user
router.get('/', authenticateToken, (req, res) => {
    try {
        const connections = db.prepare(`
            SELECT id, type, name, status, last_tested_at, last_error, created_at, updated_at
            FROM connections 
            WHERE user_id = ?
            ORDER BY created_at DESC
        `).all(req.user.id);

        res.json({
            success: true,
            data: { connections: connections || [] }
        });
    } catch (err) {
        console.error('Get connections error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get connections'
        });
    }
});

// Get single connection
router.get('/:id', authenticateToken, (req, res) => {
    try {
        const connection = db.prepare(`
            SELECT id, type, name, status, config, last_tested_at, last_error, created_at, updated_at
            FROM connections 
            WHERE id = ? AND user_id = ?
        `).get(req.params.id, req.user.id);

        if (!connection) {
            return res.status(404).json({
                success: false,
                error: 'Connection not found'
            });
        }

        // Parse config but don't return credentials
        if (connection.config) {
            connection.config = JSON.parse(connection.config);
        }

        res.json({
            success: true,
            data: { connection }
        });
    } catch (err) {
        console.error('Get connection error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to get connection'
        });
    }
});

// Create new connection
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { type, name, credentials, config } = req.body;

        // Validate type
        const validTypes = ['wordpress', 'github', 'googlesheets'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                error: `Invalid connection type. Must be one of: ${validTypes.join(', ')}`
            });
        }

        if (!credentials) {
            return res.status(400).json({
                success: false,
                error: 'Credentials are required'
            });
        }

        // Test connection based on type
        let testResult = { success: true };
        try {
            testResult = await testConnection(type, credentials, config);
        } catch (testErr) {
            testResult = { success: false, error: testErr.message };
        }

        const result = db.prepare(`
            INSERT INTO connections (user_id, type, name, credentials, config, status, last_tested_at, last_error)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `).run(
            req.user.id,
            type,
            name || `${type.charAt(0).toUpperCase() + type.slice(1)} Connection`,
            JSON.stringify(credentials),
            config ? JSON.stringify(config) : null,
            testResult.success ? 'active' : 'error',
            testResult.success ? null : testResult.error
        );

        // Log activity
        db.prepare(`
            INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
            VALUES (?, 'created', 'connection', ?, ?)
        `).run(req.user.id, result.lastInsertRowid, JSON.stringify({ type, status: testResult.success ? 'active' : 'error' }));

        res.status(201).json({
            success: true,
            message: testResult.success ? 'Connection created successfully' : 'Connection created but test failed',
            data: {
                connection: {
                    id: result.lastInsertRowid,
                    type,
                    name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} Connection`,
                    status: testResult.success ? 'active' : 'error',
                    lastError: testResult.success ? null : testResult.error
                }
            }
        });
    } catch (err) {
        console.error('Create connection error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to create connection'
        });
    }
});

// Update connection
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { name, credentials, config } = req.body;
        const connectionId = req.params.id;

        // Check connection exists
        const existing = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(connectionId, req.user.id);
        if (!existing) {
            return res.status(404).json({
                success: false,
                error: 'Connection not found'
            });
        }

        // Test if credentials provided
        let testResult = { success: true };
        if (credentials) {
            try {
                testResult = await testConnection(existing.type, credentials, config);
            } catch (testErr) {
                testResult = { success: false, error: testErr.message };
            }
        }

        const updates = [];
        const values = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (credentials !== undefined) {
            updates.push('credentials = ?');
            values.push(JSON.stringify(credentials));
        }
        if (config !== undefined) {
            updates.push('config = ?');
            values.push(JSON.stringify(config));
        }

        updates.push('status = ?');
        values.push(testResult.success ? 'active' : 'error');
        updates.push('last_tested_at = CURRENT_TIMESTAMP');
        updates.push('last_error = ?');
        values.push(testResult.success ? null : testResult.error);
        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(connectionId);

        db.prepare(`UPDATE connections SET ${updates.join(', ')} WHERE id = ?`).run(...values);

        res.json({
            success: true,
            message: testResult.success ? 'Connection updated successfully' : 'Connection updated but test failed',
            data: {
                connection: {
                    id: parseInt(connectionId),
                    status: testResult.success ? 'active' : 'error',
                    lastError: testResult.success ? null : testResult.error
                }
            }
        });
    } catch (err) {
        console.error('Update connection error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to update connection'
        });
    }
});

// Test connection
router.post('/:id/test', authenticateToken, async (req, res) => {
    try {
        const connection = db.prepare('SELECT * FROM connections WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
        if (!connection) {
            return res.status(404).json({
                success: false,
                error: 'Connection not found'
            });
        }

        const credentials = JSON.parse(connection.credentials);
        const config = connection.config ? JSON.parse(connection.config) : null;

        let testResult;
        try {
            testResult = await testConnection(connection.type, credentials, config);
        } catch (testErr) {
            testResult = { success: false, error: testErr.message };
        }

        // Update connection status
        db.prepare(`
            UPDATE connections 
            SET status = ?, last_tested_at = CURRENT_TIMESTAMP, last_error = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            testResult.success ? 'active' : 'error',
            testResult.success ? null : testResult.error,
            req.params.id
        );

        res.json({
            success: testResult.success,
            message: testResult.success ? 'Connection test successful' : 'Connection test failed',
            error: testResult.error || null
        });
    } catch (err) {
        console.error('Test connection error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to test connection'
        });
    }
});

// Delete connection
router.delete('/:id', authenticateToken, (req, res) => {
    try {
        const result = db.prepare('DELETE FROM connections WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                error: 'Connection not found'
            });
        }

        res.json({
            success: true,
            message: 'Connection deleted successfully'
        });
    } catch (err) {
        console.error('Delete connection error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to delete connection'
        });
    }
});

// Helper function to test connections
async function testConnection(type, credentials, config) {
    switch (type) {
        case 'wordpress':
            return testWordPressConnection(credentials);
        case 'github':
            return testGitHubConnection(credentials);
        case 'googlesheets':
            return testGoogleSheetsConnection(credentials);
        default:
            return { success: false, error: 'Unknown connection type' };
    }
}

async function testWordPressConnection(credentials) {
    try {
        const axios = require('axios');
        const { url, username, password } = credentials;
        
        if (!url || !username || !password) {
            return { success: false, error: 'Missing required credentials: url, username, password' };
        }

        // Test by fetching users
        const response = await axios.get(`${url}/wp-json/wp/v2/users`, {
            auth: { username, password },
            timeout: 10000
        });

        return { success: response.status === 200 };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function testGitHubConnection(credentials) {
    try {
        const axios = require('axios');
        const { token, repo } = credentials;
        
        if (!token) {
            return { success: false, error: 'Missing required credential: token' };
        }

        const response = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `token ${token}` },
            timeout: 10000
        });

        return { success: response.status === 200 };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function testGoogleSheetsConnection(credentials) {
    // Placeholder - would need Google API implementation
    return { success: true, message: 'Google Sheets connection test not implemented' };
}

module.exports = router;