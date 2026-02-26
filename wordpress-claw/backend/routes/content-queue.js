const express = require('express');
const db = require('../database/db');
const { authenticateToken, requireCredits } = require('../middleware/auth');
const SummonAgent = require('../services/summonAgent');
const XlsxService = require('../services/xlsxService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        if (XlsxService.isSupportedFile(file.originalname)) {
            cb(null, true);
        } else {
            cb(new Error('Only .xlsx, .xls, .csv, and .ods files are allowed'));
        }
    }
});

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads', { recursive: true });
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Helper function to get user from token
async function getUserFromToken(req) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
        const jwt = require('jsonwebtoken');
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
            if (user) {
                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    tier: user.tier,
                    creditsIncluded: user.credits_included,
                    creditsUsed: user.credits_used
                };
            }
        } catch (e) {
            // Invalid token
        }
    }
    
    return null;
}

// Middleware to require auth for form routes
async function requireAuth(req, res, next) {
    const user = await getUserFromToken(req);
    if (!user) {
        if (req.headers['content-type']?.includes('application/json')) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        return res.redirect('/login.html');
    }
    req.user = user;
    next();
}

// Generate HTML page
function generatePage(content, user, flash = null) {
    const flashHtml = flash ? `
        <div class="flash flash-${flash.type}">
            ${escapeHtml(flash.message)}
        </div>
    ` : '';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Content Queue - WordPress Claw</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary: #E53935;
            --primary-dark: #C62828;
            --text: #1a1a1a;
            --text-secondary: #666;
            --bg: #f8f9fa;
            --bg-card: #ffffff;
            --border: #e5e5e5;
            --success: #4caf50;
            --warning: #ff9800;
            --error: #f44336;
            --info: #2196f3;
            --shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            color: var(--text);
            line-height: 1.6;
            background: var(--bg);
        }
        .dashboard { display: flex; min-height: 100vh; }
        .sidebar {
            width: 260px;
            background: var(--bg-card);
            border-right: 1px solid var(--border);
            display: flex;
            flex-direction: column;
            position: fixed;
            height: 100vh;
            z-index: 100;
        }
        .sidebar-header { padding: 20px 24px; border-bottom: 1px solid var(--border); }
        .sidebar-logo { display: flex; align-items: center; gap: 12px; }
        .sidebar-logo img { height: 72px; width: auto; max-width: 220px; object-fit: contain; }
        .sidebar-nav { flex: 1; padding: 16px 12px; overflow-y: auto; }
        .nav-section { margin-bottom: 24px; }
        .nav-section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            padding: 0 12px;
            margin-bottom: 8px;
        }
        .nav-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 12px;
            border-radius: 8px;
            text-decoration: none;
            color: var(--text-secondary);
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
        }
        .nav-item:hover { background: var(--bg); color: var(--text); }
        .nav-item.active { background: rgba(229, 57, 53, 0.1); color: var(--primary); }
        .nav-icon { width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; }
        .sidebar-footer { padding: 16px; border-top: 1px solid var(--border); }
        .user-menu {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .user-menu:hover { background: var(--bg); }
        .user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--primary);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 14px;
        }
        .user-info { flex: 1; overflow: hidden; }
        .user-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .user-tier { font-size: 12px; color: var(--text-secondary); text-transform: capitalize; }
        .main { flex: 1; margin-left: 260px; padding: 32px; }
        .page-header { margin-bottom: 32px; }
        .page-header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
        .page-header p { color: var(--text-secondary); }
        .flash {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-weight: 500;
        }
        .flash-success { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
        .flash-error { background: #ffebee; color: #c62828; border: 1px solid #ef9a9a; }
        .flash-info { background: #e3f2fd; color: #1565c0; border: 1px solid #90caf9; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 32px;
        }
        .stat-card {
            background: var(--bg-card);
            border-radius: 12px;
            padding: 20px;
            box-shadow: var(--shadow);
            text-align: center;
        }
        .stat-value { font-size: 32px; font-weight: 700; color: var(--primary); margin-bottom: 4px; }
        .stat-label { font-size: 13px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }
        .card {
            background: var(--bg-card);
            border-radius: 12px;
            padding: 24px;
            box-shadow: var(--shadow);
            margin-bottom: 24px;
        }
        .card h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 16px;
        }
        .form-group { display: flex; flex-direction: column; }
        .form-group.full-width { grid-column: 1 / -1; }
        .form-group label {
            font-size: 13px;
            font-weight: 500;
            color: var(--text-secondary);
            margin-bottom: 6px;
        }
        .form-group input,
        .form-group textarea,
        .form-group select {
            padding: 10px 14px;
            border: 1px solid var(--border);
            border-radius: 8px;
            font-size: 14px;
            font-family: inherit;
            transition: border-color 0.2s;
        }
        .form-group input:focus,
        .form-group textarea:focus,
        .form-group select:focus {
            outline: none;
            border-color: var(--primary);
        }
        .form-group textarea { resize: vertical; min-height: 60px; }
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
        }
        .btn-primary { background: var(--primary); color: white; }
        .btn-primary:hover { background: var(--primary-dark); }
        .btn-secondary { background: var(--bg); color: var(--text); border: 1px solid var(--border); }
        .btn-secondary:hover { background: var(--border); }
        .btn-success { background: var(--success); color: white; }
        .btn-success:hover { background: #388e3c; }
        .btn-danger { background: var(--error); color: white; }
        .btn-danger:hover { background: #d32f2f; }
        .btn-sm { padding: 6px 12px; font-size: 12px; }
        .import-export-section { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--border); }
        .import-export-section h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: var(--text); }
        .import-export-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .import-box, .export-box {
            background: var(--bg);
            border-radius: 8px;
            padding: 20px;
            border: 1px dashed var(--border);
        }
        .import-hint, .export-hint { font-size: 14px; font-weight: 500; color: var(--text); margin-bottom: 8px; }
        .import-format, .export-format { font-size: 12px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5; }
        .queue-table { width: 100%; border-collapse: collapse; }
        .queue-table th,
        .queue-table td {
            padding: 12px 16px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }
        .queue-table th {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--text-secondary);
            background: var(--bg);
        }
        .queue-table tr:hover { background: var(--bg); }
        .queue-table td { font-size: 14px; }
        .queue-keyword { font-weight: 600; }
        .queue-meta { font-size: 12px; color: var(--text-secondary); }
        .status-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            display: inline-block;
        }
        .status-pending { background: #fff3e0; color: #ef6c00; }
        .status-processing { background: #e3f2fd; color: #1565c0; }
        .status-done { background: #e8f5e9; color: #2e7d32; }
        .status-error { background: #ffebee; color: #c62828; }
        .actions { display: flex; gap: 8px; }
        .empty-state {
            padding: 60px 24px;
            text-align: center;
            color: var(--text-secondary);
        }
        .empty-state-icon { font-size: 64px; margin-bottom: 16px; opacity: 0.5; }
        .empty-state h3 { font-size: 18px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        .card-header h2 { margin-bottom: 0; }
        @media (max-width: 768px) {
            .sidebar { transform: translateX(-100%); transition: transform 0.3s ease; }
            .sidebar.show { transform: translateX(0); }
            .main { margin-left: 0; padding: 80px 16px 16px; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
            .form-row { grid-template-columns: 1fr; }
            .import-export-grid { grid-template-columns: 1fr; }
            .queue-table { display: block; overflow-x: auto; }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <aside class="sidebar">
            <div class="sidebar-header">
                <a href="/" class="sidebar-logo">
                    <img src="/assets/logo.png" alt="WordPress Claw">
                </a>
            </div>
            <nav class="sidebar-nav">
                <div class="nav-section">
                    <div class="nav-section-title">Main</div>
                    <a href="/dashboard/" class="nav-item">
                        <span class="nav-icon">📊</span>
                        Dashboard
                    </a>
                    <a href="/dashboard/articles.html" class="nav-item">
                        <span class="nav-icon">📝</span>
                        Articles
                    </a>
                    <a href="/dashboard/clawbot.html" class="nav-item">
                        <span class="nav-icon">🤖</span>
                        ClawBot
                    </a>
                    <a href="/content-queue" class="nav-item active">
                        <span class="nav-icon">📋</span>
                        Content Queue
                    </a>
                </div>
                <div class="nav-section">
                    <div class="nav-section-title">Settings</div>
                    <a href="/dashboard/business-profile.html" class="nav-item">
                        <span class="nav-icon">🏢</span>
                        Business Profile
                    </a>
                    <a href="/dashboard/connections.html" class="nav-item">
                        <span class="nav-icon">🔗</span>
                        Connections
                    </a>
                    <a href="/dashboard/billing.html" class="nav-item">
                        <span class="nav-icon">💳</span>
                        Billing
                    </a>
                </div>
            </nav>
            <div class="sidebar-footer">
                <div class="user-menu">
                    <div class="user-avatar">${escapeHtml((user.name || 'U').charAt(0).toUpperCase())}</div>
                    <div class="user-info">
                        <div class="user-name">${escapeHtml(user.name || 'User')}</div>
                        <div class="user-tier">${escapeHtml(user.tier || 'free')} Plan</div>
                    </div>
                </div>
            </div>
        </aside>
        <main class="main">
            ${flashHtml}
            ${content}
        </main>
    </div>
</body>
</html>`;
}

// ============================================================================
// FORM-BASED ROUTES (Server-rendered HTML, no JavaScript)
// ============================================================================

// GET /content-queue - Show the content queue page (server-rendered)
router.get('/', requireAuth, async (req, res) => {
    try {
        const status = req.query.status;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = parseInt(req.query.offset) || 0;

        // Get items
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

        // Get counts
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

        // Build content HTML
        let content = `
            <div class="page-header">
                <h1>Content Queue</h1>
                <p>Add topics, track status, and process with AI.</p>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${counts.total}</div>
                    <div class="stat-label">Total</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="color: var(--warning);">${counts.pending}</div>
                    <div class="stat-label">Pending</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="color: var(--info);">${counts.processing}</div>
                    <div class="stat-label">Processing</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" style="color: var(--success);">${counts.done}</div>
                    <div class="stat-label">Done</div>
                </div>
            </div>
            
            <div class="card">
                <h2>Add New Topic</h2>
                <form action="/content-queue/add" method="POST">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="mainKeyword">Main Keyword *</label>
                            <input type="text" id="mainKeyword" name="main_keyword" placeholder="e.g., best wordpress plugins" required>
                        </div>
                        <div class="form-group">
                            <label for="serviceUrl">Service URL</label>
                            <input type="url" id="serviceUrl" name="service_url" placeholder="https://example.com/service">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group full-width">
                            <label for="clusterKeywords">Cluster Keywords</label>
                            <textarea id="clusterKeywords" name="cluster_keywords" placeholder="Enter related keywords, separated by commas..."></textarea>
                        </div>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">➕ Add to Queue</button>
                    </div>
                </form>
                
                <div class="import-export-section">
                    <h3>📁 Bulk Import / Export</h3>
                    <div class="import-export-grid">
                        <div class="import-box">
                            <p class="import-hint">Import from Excel (.xlsx) or CSV (.csv)</p>
                            <p class="import-format">Required column: <strong>Main Keyword</strong><br>Optional: Service URL, Cluster Keywords, Status</p>
                            <form action="/content-queue/import" method="POST" enctype="multipart/form-data">
                                <input type="file" name="file" accept=".xlsx,.xls,.csv,.ods" required style="margin-bottom: 12px;">
                                <button type="submit" class="btn btn-secondary">📥 Import File</button>
                            </form>
                        </div>
                        <div class="export-box">
                            <p class="export-hint">Export your content queue to Excel</p>
                            <p class="export-format">Exports all items with their current status</p>
                            <form action="/content-queue/export" method="POST">
                                <button type="submit" class="btn btn-secondary">📤 Export to Excel</button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h2>Queue Items</h2>
                    <div class="actions">
                        ${counts.pending > 0 ? `
                            <form action="/content-queue/process-all" method="POST" style="display: inline;">
                                <button type="submit" class="btn btn-success btn-sm" onclick="return confirm('Process all ${counts.pending} pending items? This will use ${counts.pending} credits.')">⚡ Process All Pending</button>
                            </form>
                        ` : ''}
                        <a href="/content-queue" class="btn btn-secondary btn-sm">🔄 Refresh</a>
                    </div>
                </div>
        `;
        
        if (items.length === 0) {
            content += `
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <h3>Your queue is empty</h3>
                    <p>Add your first topic above to get started.</p>
                </div>
            `;
        } else {
            content += `
                <table class="queue-table">
                    <thead>
                        <tr>
                            <th>Keyword</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            for (const item of items) {
                const createdDate = new Date(item.created_at).toLocaleDateString();
                content += `
                    <tr>
                        <td>
                            <div class="queue-keyword">${escapeHtml(item.main_keyword)}</div>
                            ${item.service_url ? `<div class="queue-meta">🔗 ${escapeHtml(item.service_url.substring(0, 50))}${item.service_url.length > 50 ? '...' : ''}</div>` : ''}
                            ${item.cluster_keywords ? `<div class="queue-meta">🏷️ ${escapeHtml(item.cluster_keywords.substring(0, 50))}${item.cluster_keywords.length > 50 ? '...' : ''}</div>` : ''}
                            ${item.wp_post_url ? `<div class="queue-meta"><a href="${escapeHtml(item.wp_post_url)}" target="_blank" style="color: var(--success);">🔗 View Published Post</a></div>` : ''}
                        </td>
                        <td><span class="status-badge status-${item.status}">${item.status}</span></td>
                        <td>${createdDate}</td>
                        <td>
                            <div class="actions">
                                ${item.status === 'pending' ? `
                                    <form action="/content-queue/${item.id}/process" method="POST" style="display: inline;">
                                        <button type="submit" class="btn btn-primary btn-sm" onclick="return confirm('Process this item with AI? This will use 1 credit.')">⚡ Process</button>
                                    </form>
                                ` : ''}
                                <form action="/content-queue/${item.id}/delete" method="POST" style="display: inline;">
                                    <button type="submit" class="btn btn-danger btn-sm" onclick="return confirm('Delete this item?')">🗑️ Delete</button>
                                </form>
                            </div>
                        </td>
                    </tr>
                `;
            }
            
            content += `
                    </tbody>
                </table>
            `;
        }
        
        content += `</div>`;
        
        // Get flash message from query params
        const flash = req.query.message ? { type: req.query.type || 'info', message: req.query.message } : null;
        
        res.send(generatePage(content, req.user, flash));
    } catch (err) {
        console.error('Get content queue error:', err);
        res.status(500).send(generatePage(`
            <div class="page-header">
                <h1>Error</h1>
                <p>Failed to load content queue. Please try again.</p>
            </div>
        `, req.user, { type: 'error', message: 'Failed to load content queue' }));
    }
});

// POST /content-queue/add - Add new item
router.post('/add', requireAuth, async (req, res) => {
    try {
        const { main_keyword, service_url, cluster_keywords } = req.body;

        if (!main_keyword || !main_keyword.trim()) {
            return res.redirect('/content-queue?type=error&message=Main keyword is required');
        }

        await db.prepare(`
            INSERT INTO content_queue (user_id, service_url, main_keyword, cluster_keywords, status)
            VALUES (?, ?, ?, ?, 'pending')
        `).run(
            req.user.id,
            service_url || null,
            main_keyword.trim(),
            cluster_keywords || null
        );

        res.redirect('/content-queue?type=success&message=Item added to queue');
    } catch (err) {
        console.error('Add to queue error:', err);
        res.redirect('/content-queue?type=error&message=Failed to add item');
    }
});

// POST /content-queue/:id/process - Process item with AI
router.post('/:id/process', requireAuth, async (req, res) => {
    try {
        const itemId = req.params.id;

        // Get the queue item
        const item = await db.prepare('SELECT * FROM content_queue WHERE id = ? AND user_id = ?').get(itemId, req.user.id);
        if (!item) {
            return res.redirect('/content-queue?type=error&message=Item not found');
        }

        if (!item.main_keyword) {
            return res.redirect('/content-queue?type=error&message=Item has no main keyword to process');
        }

        // Check credits
        if (req.user.tier !== 'pro') {
            const availableCredits = req.user.creditsIncluded - req.user.creditsUsed;
            if (availableCredits < 1) {
                return res.redirect('/content-queue?type=error&message=Insufficient credits');
            }
        }

        // Update status to processing
        await db.prepare(`
            UPDATE content_queue SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(itemId);

        // Process in background (don't wait)
        (async () => {
            try {
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
                try {
                    await db.prepare(`
                        UPDATE content_queue SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?
                    `).run(itemId);
                } catch (updateErr) {
                    console.error('Failed to update error status:', updateErr);
                }
            }
        })();

        res.redirect('/content-queue?type=success&message=Processing started. Refresh to see updates.');
    } catch (err) {
        console.error('Process queue item error:', err);
        res.redirect('/content-queue?type=error&message=Failed to start processing');
    }
});

// POST /content-queue/:id/delete - Delete item
router.post('/:id/delete', requireAuth, async (req, res) => {
    try {
        const result = await db.prepare('DELETE FROM content_queue WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
        
        if (result.changes === 0) {
            return res.redirect('/content-queue?type=error&message=Item not found');
        }

        res.redirect('/content-queue?type=success&message=Item deleted successfully');
    } catch (err) {
        console.error('Delete queue item error:', err);
        res.redirect('/content-queue?type=error&message=Failed to delete item');
    }
});

// POST /content-queue/process-all - Process all pending items
router.post('/process-all', requireAuth, async (req, res) => {
    try {
        // Get all pending items
        const pendingItems = await db.prepare(`
            SELECT id, main_keyword 
            FROM content_queue 
            WHERE user_id = ? AND status = 'pending' AND main_keyword IS NOT NULL
            ORDER BY created_at ASC
        `).all(req.user.id);

        if (pendingItems.length === 0) {
            return res.redirect('/content-queue?type=info&message=No pending items to process');
        }

        // Check credits
        if (req.user.tier !== 'pro') {
            const availableCredits = req.user.creditsIncluded - req.user.creditsUsed;
            if (availableCredits < pendingItems.length) {
                return res.redirect('/content-queue?type=error&message=Insufficient credits for all items');
            }
        }

        // Update all to processing
        for (const item of pendingItems) {
            await db.prepare(`
                UPDATE content_queue SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?
            `).run(item.id);
        }

        // Process in background
        (async () => {
            try {
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
                            if (req.user.tier !== 'pro') {
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
            }
        })();

        res.redirect('/content-queue?type=success&message=Started processing ' + pendingItems.length + ' items. Refresh to see updates.');
    } catch (err) {
        console.error('Process all error:', err);
        res.redirect('/content-queue?type=error&message=Failed to process items');
    }
});

// POST /content-queue/import - Import from XLSX/CSV
router.post('/import', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.redirect('/content-queue?type=error&message=No file uploaded');
        }

        const filePath = req.file.path;
        const originalName = req.file.originalname;

        // Read the file
        const readResult = XlsxService.readFile(filePath);
        
        // Clean up uploaded file
        fs.unlinkSync(filePath);

        if (!readResult.success) {
            return res.redirect('/content-queue?type=error&message=Failed to read file: ' + readResult.error);
        }

        // Parse content queue items
        const parseResult = XlsxService.parseContentQueueImport(readResult);

        if (!parseResult.success || parseResult.items.length === 0) {
            return res.redirect('/content-queue?type=error&message=No valid items found in file');
        }

        // Insert items into database
        let importedCount = 0;
        for (const item of parseResult.items) {
            try {
                await db.prepare(`
                    INSERT INTO content_queue (user_id, service_url, main_keyword, cluster_keywords, status)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    req.user.id,
                    item.service_url,
                    item.main_keyword,
                    item.cluster_keywords,
                    item.status
                );
                importedCount++;
            } catch (err) {
                console.error('Failed to insert item:', err);
            }
        }

        res.redirect('/content-queue?type=success&message=Imported ' + importedCount + ' items successfully');
    } catch (err) {
        console.error('Import xlsx error:', err);
        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.redirect('/content-queue?type=error&message=Failed to import file: ' + err.message);
    }
});

// POST /content-queue/export - Export to XLSX
router.post('/export', requireAuth, async (req, res) => {
    try {
        const { status } = req.body;

        // Build query
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

        query += ' ORDER BY created_at DESC';

        const items = await db.prepare(query).all(...params);

        if (items.length === 0) {
            return res.redirect('/content-queue?type=error&message=No items to export');
        }

        // Convert to Excel format
        const { headers, rows } = XlsxService.convertContentQueueToExcel(items);

        // Generate Excel buffer
        const writeResult = XlsxService.writeBuffer(headers, rows, {
            sheetName: 'Content Queue'
        });

        if (!writeResult.success) {
            return res.redirect('/content-queue?type=error&message=Failed to generate Excel file');
        }

        // Set response headers for file download
        const filename = `content-queue-${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', writeResult.buffer.length);

        // Send the file
        res.send(writeResult.buffer);

    } catch (err) {
        console.error('Export xlsx error:', err);
        res.redirect('/content-queue?type=error&message=Failed to export file: ' + err.message);
    }
});

// ============================================================================
// API Routes (for JSON responses - keep backward compatibility)
// These are mounted separately in server.js at /api/content-queue
// ============================================================================

// Create a separate router for API routes
const apiRouter = express.Router();

/**
 * Get all content queue items for the user (API)
 * GET /api/content-queue
 */
apiRouter.get('/', authenticateToken, async (req, res) => {
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
 * Add new item to content queue (API)
 * POST /api/content-queue
 */
apiRouter.post('/', authenticateToken, async (req, res) => {
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
 * Update a content queue item (API)
 * PUT /api/content-queue/:id
 */
apiRouter.put('/:id', authenticateToken, async (req, res) => {
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
 * Delete a content queue item (API)
 * DELETE /api/content-queue/:id
 */
apiRouter.delete('/:id', authenticateToken, async (req, res) => {
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
 * Process a content queue item with AI (API)
 * POST /api/content-queue/:id/process
 */
apiRouter.post('/:id/process', authenticateToken, requireCredits, async (req, res) => {
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
 * Process all pending items (API)
 * POST /api/content-queue/process-all
 */
apiRouter.post('/process-all', authenticateToken, requireCredits, async (req, res) => {
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

/**
 * Import content queue items from XLSX/CSV file (API)
 * POST /api/content-queue/import-xlsx
 */
apiRouter.post('/import-xlsx', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        const filePath = req.file.path;
        const originalName = req.file.originalname;

        // Read the file
        const readResult = XlsxService.readFile(filePath);
        
        // Clean up uploaded file
        fs.unlinkSync(filePath);

        if (!readResult.success) {
            return res.status(400).json({
                success: false,
                error: 'Failed to read file: ' + readResult.error
            });
        }

        // Parse content queue items
        const parseResult = XlsxService.parseContentQueueImport(readResult);

        if (!parseResult.success || parseResult.items.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid items found in file',
                details: parseResult.errors
            });
        }

        // Insert items into database
        const insertedItems = [];
        const insertErrors = [];

        for (const item of parseResult.items) {
            try {
                const result = await db.prepare(`
                    INSERT INTO content_queue (user_id, service_url, main_keyword, cluster_keywords, status)
                    VALUES (?, ?, ?, ?, ?)
                `).run(
                    req.user.id,
                    item.service_url,
                    item.main_keyword,
                    item.cluster_keywords,
                    item.status
                );

                insertedItems.push({
                    id: result.lastInsertRowid,
                    ...item
                });
            } catch (err) {
                insertErrors.push(`Failed to insert "${item.main_keyword}": ${err.message}`);
            }
        }

        res.json({
            success: true,
            message: `Imported ${insertedItems.length} items successfully`,
            data: {
                fileName: originalName,
                fileType: XlsxService.getFileType(originalName),
                totalRows: parseResult.totalRows,
                imported: insertedItems.length,
                items: insertedItems,
                parseErrors: parseResult.errors,
                insertErrors: insertErrors
            }
        });

    } catch (err) {
        console.error('Import xlsx error:', err);
        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({
            success: false,
            error: 'Failed to import file: ' + err.message
        });
    }
});

/**
 * Export content queue items to XLSX file (API)
 * POST /api/content-queue/export-xlsx
 */
apiRouter.post('/export-xlsx', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;

        // Build query
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

        query += ' ORDER BY created_at DESC';

        const items = await db.prepare(query).all(...params);

        if (items.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No items to export'
            });
        }

        // Convert to Excel format
        const { headers, rows } = XlsxService.convertContentQueueToExcel(items);

        // Generate Excel buffer
        const writeResult = XlsxService.writeBuffer(headers, rows, {
            sheetName: 'Content Queue'
        });

        if (!writeResult.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to generate Excel file: ' + writeResult.error
            });
        }

        // Set response headers for file download
        const filename = `content-queue-${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', writeResult.buffer.length);

        // Send the file
        res.send(writeResult.buffer);

    } catch (err) {
        console.error('Export xlsx error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to export file: ' + err.message
        });
    }
});

// Export both routers
module.exports = router;
module.exports.apiRouter = apiRouter;
