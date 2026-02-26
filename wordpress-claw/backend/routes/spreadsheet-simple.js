const express = require('express');
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');
const path = require('path');

const router = express.Router();

// Column mapping from various header formats to our standard columns
const COLUMN_MAPPINGS = {
    'service_url': ['service url', 'service_url', 'serviceurl', 'url', 'service', 'page url', 'page_url', 'link'],
    'main_keyword': ['main keyword', 'main_keyword', 'mainkeyword', 'keyword', 'primary keyword', 'focus keyword', 'topic', 'subject'],
    'cluster_keywords': ['cluster keywords', 'cluster_keywords', 'clusterkeywords', 'secondary keywords', 'keywords', 'related keywords', 'cluster'],
    'gdocs_link': ['gdocs link', 'gdocs_link', 'gdocslink', 'google doc', 'google docs', 'doc link', 'document', 'gdoc'],
    'wp_post_url': ['wp post url', 'wp_post_url', 'wpposturl', 'wordpress url', 'post url', 'published url', 'live url', 'article url'],
    'status': ['status', 'state', 'progress', 'stage'],
    'feature_image': ['feature image', 'feature_image', 'featureimage', 'featured image', 'image', 'hero image', 'thumbnail']
};

/**
 * Normalize header name to our standard column names
 */
function normalizeHeader(header) {
    const lowerHeader = header.toLowerCase().trim().replace(/[^a-z0-9\s_]/g, '');
    
    for (const [standard, variations] of Object.entries(COLUMN_MAPPINGS)) {
        if (variations.includes(lowerHeader)) {
            return standard;
        }
    }
    return lowerHeader.replace(/\s+/g, '_');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Render the spreadsheet HTML page
 */
async function renderSpreadsheetPage(req, res, options = {}) {
    const { message, messageType, filter = 'all' } = options;
    
    try {
        // Get all rows for this user
        let query;
        let params;
        
        if (filter && filter !== 'all') {
            if (db.isPostgres) {
                query = `SELECT * FROM spreadsheet_rows WHERE user_id = $1 AND status = $2 ORDER BY row_order ASC`;
                params = [req.user.id, filter.toUpperCase()];
            } else {
                query = `SELECT * FROM spreadsheet_rows WHERE user_id = ? AND status = ? ORDER BY row_order ASC`;
                params = [req.user.id, filter.toUpperCase()];
            }
        } else {
            if (db.isPostgres) {
                query = `SELECT * FROM spreadsheet_rows WHERE user_id = $1 ORDER BY row_order ASC`;
                params = [req.user.id];
            } else {
                query = `SELECT * FROM spreadsheet_rows WHERE user_id = ? ORDER BY row_order ASC`;
                params = [req.user.id];
            }
        }
        
        const rows = await db.prepare(query).all(...params);
        
        // Get stats
        let statsQuery;
        if (db.isPostgres) {
            statsQuery = `SELECT status, COUNT(*) as count FROM spreadsheet_rows WHERE user_id = $1 GROUP BY status`;
        } else {
            statsQuery = `SELECT status, COUNT(*) as count FROM spreadsheet_rows WHERE user_id = ? GROUP BY status`;
        }
        const statsRows = await db.prepare(statsQuery).all(req.user.id);
        
        const stats = {
            total: rows.length,
            pending: 0,
            processing: 0,
            done: 0,
            error: 0
        };
        
        statsRows.forEach(s => {
            const statusLower = s.status.toLowerCase();
            if (statusLower === 'pending') stats.pending = parseInt(s.count);
            else if (statusLower === 'processing') stats.processing = parseInt(s.count);
            else if (['done', 'completed', 'success', 'published'].includes(statusLower)) stats.done = parseInt(s.count);
            else if (['error', 'failed'].includes(statusLower)) stats.error = parseInt(s.count);
        });
        
        // Get user info
        const user = req.user;
        
        // Generate table rows HTML
        let tableRowsHtml = '';
        if (rows.length === 0) {
            tableRowsHtml = '';
        } else {
            for (const row of rows) {
                const statusClass = (row.status || 'pending').toLowerCase();
                const keywordsList = row.cluster_keywords ? row.cluster_keywords.split(',').map(k => k.trim()).filter(k => k) : [];
                
                let clusterCellHtml;
                if (keywordsList.length <= 1) {
                    clusterCellHtml = `<input type="text" class="cell-input" name="cluster_keywords" value="${escapeHtml(row.cluster_keywords || '')}" placeholder="keyword1, keyword2...">`;
                } else {
                    clusterCellHtml = `<input type="text" class="cell-input" name="cluster_keywords" value="${escapeHtml(row.cluster_keywords || '')}" placeholder="keyword1, keyword2..." title="${escapeHtml(row.cluster_keywords)}">`;
                }
                
                tableRowsHtml += `
                <tr>
                    <td>
                        <form method="POST" action="/api/spreadsheet-simple/save/${row.id}" id="form-${row.id}">
                        <input type="text" class="cell-input url-cell" name="service_url" value="${escapeHtml(row.service_url || '')}" placeholder="https://...">
                    </td>
                    <td>
                        <input type="text" class="cell-input" name="main_keyword" value="${escapeHtml(row.main_keyword || '')}" placeholder="Enter keyword...">
                    </td>
                    <td>
                        ${clusterCellHtml}
                    </td>
                    <td>
                        <input type="text" class="cell-input url-cell" name="gdocs_link" value="${escapeHtml(row.gdocs_link || '')}" placeholder="Google Doc link...">
                    </td>
                    <td>
                        <input type="text" class="cell-input url-cell" name="wp_post_url" value="${escapeHtml(row.wp_post_url || '')}" placeholder="WordPress URL...">
                    </td>
                    <td>
                        <input type="text" class="cell-input status-input status-${statusClass}" name="status" value="${escapeHtml(row.status || 'PENDING')}" placeholder="PENDING, PROCESSING, DONE, ERROR">
                    </td>
                    <td>
                        <input type="text" class="cell-input url-cell" name="feature_image" value="${escapeHtml(row.feature_image || '')}" placeholder="Image URL...">
                    </td>
                    <td>
                        <div class="row-actions">
                            <button type="submit" class="btn-icon" title="Save">💾</button>
                            <button type="submit" formaction="/api/spreadsheet-simple/process/${row.id}" class="btn-icon process" title="Process">⚡</button>
                            <button type="submit" formaction="/api/spreadsheet-simple/delete/${row.id}" class="btn-icon delete" title="Delete">🗑️</button>
                        </div>
                        </form>
                    </td>
                </tr>`;
            }
        }
        
        // Generate alert HTML
        let alertHtml = '';
        if (message) {
            alertHtml = `<div class="alert ${messageType}">${escapeHtml(message)}</div>`;
        }
        
        // Generate empty state HTML
        const emptyStateHtml = rows.length === 0 ? `
        <div class="empty-state">
            <h3>No Data Yet</h3>
            <p>Import data from Google Sheets or add rows manually.</p>
            <form method="POST" action="/api/spreadsheet-simple/row" style="display:inline;">
                <button type="submit" class="btn btn-secondary">Add First Row</button>
            </form>
        </div>` : '';
        
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Simple Spreadsheet - WordPress Claw</title>
    <meta name="robots" content="noindex, nofollow">
    
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.5;
        }
        
        .dashboard { display: flex; min-height: 100vh; }
        
        .sidebar {
            width: 240px;
            background: #fff;
            border-right: 1px solid #ddd;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
        }
        
        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid #ddd;
        }
        
        .sidebar-logo img {
            max-width: 180px;
            height: auto;
        }
        
        .sidebar-nav { padding: 16px; }
        
        .nav-section { margin-bottom: 20px; }
        
        .nav-section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            color: #666;
            padding: 0 8px;
            margin-bottom: 8px;
        }
        
        .nav-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            border-radius: 6px;
            text-decoration: none;
            color: #666;
            font-size: 14px;
            margin-bottom: 4px;
        }
        
        .nav-item:hover { background: #f5f5f5; color: #333; }
        .nav-item.active { background: #ffebee; color: #c62828; }
        
        .sidebar-footer {
            padding: 16px;
            border-top: 1px solid #ddd;
            position: absolute;
            bottom: 0;
            width: 100%;
        }
        
        .user-menu {
            display: flex;
            align-items: center;
            gap: 12px;
            cursor: pointer;
            padding: 8px;
            border-radius: 6px;
        }
        
        .user-menu:hover { background: #f5f5f5; }
        
        .user-avatar {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: #c62828;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
        }
        
        .user-name { font-size: 14px; font-weight: 600; }
        .user-tier { font-size: 12px; color: #666; }
        
        .main {
            flex: 1;
            margin-left: 240px;
            padding: 24px;
        }
        
        .page-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 24px;
        }
        
        .page-header h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 4px;
        }
        
        .page-header p { color: #666; font-size: 14px; }
        
        .page-actions { display: flex; gap: 10px; }
        
        .btn {
            padding: 10px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        
        .btn-primary {
            background: #c62828;
            color: white;
        }
        
        .btn-primary:hover { background: #b71c1c; }
        
        .btn-secondary {
            background: #fff;
            color: #333;
            border: 1px solid #ddd;
        }
        
        .btn-secondary:hover { background: #f5f5f5; }
        
        .btn-danger {
            background: #fff;
            color: #c62828;
            border: 1px solid #c62828;
        }
        
        .btn-danger:hover { background: #ffebee; }
        
        .btn-small { padding: 6px 12px; font-size: 13px; }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 16px;
            margin-bottom: 24px;
        }
        
        .stat-card {
            background: #fff;
            padding: 16px;
            border-radius: 8px;
            border: 1px solid #ddd;
        }
        
        .stat-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
            font-weight: 600;
        }
        
        .stat-value {
            font-size: 28px;
            font-weight: 700;
            margin-top: 4px;
        }
        
        .filter-bar {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
            align-items: center;
        }
        
        .filter-label { font-size: 13px; color: #666; font-weight: 500; }
        
        .filter-btn {
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 13px;
            border: 1px solid #ddd;
            background: #fff;
            cursor: pointer;
            text-decoration: none;
            color: #333;
        }
        
        .filter-btn:hover { border-color: #c62828; color: #c62828; }
        .filter-btn.active { background: #c62828; color: white; border-color: #c62828; }
        
        .spreadsheet-container {
            background: #fff;
            border-radius: 8px;
            border: 1px solid #ddd;
            overflow: hidden;
        }
        
        .spreadsheet-header {
            padding: 16px 20px;
            border-bottom: 1px solid #ddd;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f9f9f9;
        }
        
        .spreadsheet-header h2 { font-size: 16px; font-weight: 600; }
        .spreadsheet-info { font-size: 13px; color: #666; }
        
        .spreadsheet-table-wrapper {
            overflow-x: auto;
            max-height: 65vh;
            overflow-y: auto;
        }
        
        .spreadsheet-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 14px;
        }
        
        .spreadsheet-table thead {
            position: sticky;
            top: 0;
            z-index: 10;
        }
        
        .spreadsheet-table th {
            background: #f5f5f5;
            padding: 12px 16px;
            text-align: left;
            font-weight: 600;
            font-size: 12px;
            text-transform: uppercase;
            color: #666;
            border-bottom: 1px solid #ddd;
            white-space: nowrap;
        }
        
        .spreadsheet-table td {
            padding: 8px 16px;
            border-bottom: 1px solid #eee;
            vertical-align: middle;
        }
        
        .spreadsheet-table tbody tr:hover { background: #fafafa; }
        
        .cell-input {
            width: 100%;
            padding: 8px 10px;
            border: 1px solid transparent;
            border-radius: 4px;
            font-size: 14px;
            font-family: inherit;
            background: transparent;
        }
        
        .cell-input:hover { background: #fff; border-color: #ddd; }
        .cell-input:focus {
            outline: none;
            background: #fff;
            border-color: #c62828;
            box-shadow: 0 0 0 2px rgba(198, 40, 40, 0.1);
        }
        
        .cell-input.url-cell { font-family: monospace; font-size: 12px; }
        
        .status-input {
            width: 100%;
            padding: 8px 10px;
            border: 1px solid transparent;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            font-family: inherit;
            background: transparent;
        }
        
        .status-input:hover { background: #fff; border-color: #ddd; }
        .status-input:focus {
            outline: none;
            background: #fff;
            border-color: #c62828;
            box-shadow: 0 0 0 2px rgba(198, 40, 40, 0.1);
        }
        
        .status-input.status-pending { background: #fff3e0; color: #e65100; }
        .status-input.status-processing { background: #e3f2fd; color: #1565c0; }
        .status-input.status-done { background: #e8f5e9; color: #2e7d32; }
        .status-input.status-error { background: #ffebee; color: #c62828; }
        
        .row-actions { display: flex; gap: 6px; }
        
        .btn-icon {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            border: 1px solid #ddd;
            background: #fff;
            cursor: pointer;
            font-size: 14px;
        }
        
        .btn-icon:hover { background: #f5f5f5; }
        .btn-icon.process { background: #c62828; color: white; border-color: #c62828; }
        .btn-icon.process:hover { background: #b71c1c; }
        .btn-icon.delete:hover { background: #ffebee; border-color: #c62828; }
        
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: #666;
        }
        
        .empty-state h3 { font-size: 20px; margin-bottom: 8px; color: #333; }
        .empty-state p { margin-bottom: 20px; }
        
        .alert {
            padding: 12px 16px;
            border-radius: 6px;
            margin-bottom: 16px;
            font-size: 14px;
        }
        
        .alert.success { background: #e8f5e9; color: #2e7d32; border: 1px solid #a5d6a7; }
        .alert.error { background: #ffebee; color: #c62828; border: 1px solid #ef9a9a; }
        .alert.info { background: #e3f2fd; color: #1565c0; border: 1px solid #90caf9; }
        
        .import-section {
            background: #fff;
            border-radius: 8px;
            border: 1px solid #ddd;
            padding: 20px;
            margin-bottom: 16px;
        }
        
        .import-section h3 { font-size: 16px; margin-bottom: 12px; }
        
        .import-textarea {
            width: 100%;
            min-height: 150px;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-family: monospace;
            font-size: 13px;
            resize: vertical;
            margin-bottom: 12px;
        }
        
        .import-textarea:focus {
            outline: none;
            border-color: #c62828;
            box-shadow: 0 0 0 2px rgba(198, 40, 40, 0.1);
        }
        
        .export-section {
            background: #f5f5f5;
            padding: 16px;
            border-radius: 6px;
            margin-top: 16px;
        }
        
        .export-content {
            background: #fff;
            padding: 16px;
            border-radius: 6px;
            font-family: monospace;
            font-size: 12px;
            white-space: pre;
            overflow-x: auto;
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid #ddd;
            margin-bottom: 12px;
        }
        
        @media (max-width: 1024px) {
            .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
        
        @media (max-width: 768px) {
            .sidebar { display: none; }
            .main { margin-left: 0; }
            .stats-grid { grid-template-columns: 1fr; }
            .page-header { flex-direction: column; gap: 16px; }
            .spreadsheet-table { font-size: 12px; }
            .spreadsheet-table th, .spreadsheet-table td { padding: 8px 12px; }
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <aside class="sidebar">
            <div class="sidebar-header">
                <a href="/" class="sidebar-logo">
                    <img src="../assets/logo.png" alt="WordPress Claw">
                </a>
            </div>
            
            <nav class="sidebar-nav">
                <div class="nav-section">
                    <div class="nav-section-title">Main</div>
                    <a href="index.html" class="nav-item">
                        <span>📊</span> Dashboard
                    </a>
                    <a href="articles.html" class="nav-item">
                        <span>📝</span> Articles
                    </a>
                    <a href="clawbot.html" class="nav-item">
                        <span>🤖</span> ClawBot
                    </a>
                    <a href="spreadsheet-simple.html" class="nav-item active">
                        <span>📋</span> Spreadsheet
                    </a>
                </div>
                
                <div class="nav-section">
                    <div class="nav-section-title">Settings</div>
                    <a href="business-profile.html" class="nav-item">
                        <span>🏢</span> Business Profile
                    </a>
                    <a href="connections.html" class="nav-item">
                        <span>🔗</span> Connections
                    </a>
                    <a href="billing.html" class="nav-item">
                        <span>💳</span> Billing
                    </a>
                </div>
            </nav>
            
            <div class="sidebar-footer">
                <a href="/dashboard/index.html" class="user-menu" style="text-decoration: none; color: inherit;">
                    <div class="user-avatar">${escapeHtml((user.name || 'U').charAt(0).toUpperCase())}</div>
                    <div>
                        <div class="user-name">${escapeHtml(user.name || 'User')}</div>
                        <div class="user-tier">${escapeHtml((user.tier || 'free') + ' Plan')}</div>
                    </div>
                </a>
            </div>
        </aside>

        <main class="main">
            <div class="page-header">
                <div>
                    <h1>📋 Content Spreadsheet</h1>
                    <p>Manage your content workflow with simple, reliable inputs.</p>
                </div>
                <div class="page-actions">
                    <a href="#import-section" class="btn btn-secondary">📥 Import</a>
                    <form method="POST" action="/api/spreadsheet-simple/row" style="display:inline;">
                        <button type="submit" class="btn btn-primary">➕ Add Row</button>
                    </form>
                </div>
            </div>

            ${alertHtml}

            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Total Topics</div>
                    <div class="stat-value">${stats.total}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Pending</div>
                    <div class="stat-value">${stats.pending}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Processing</div>
                    <div class="stat-value">${stats.processing}</div>
                </div>
                <div class="stat-card">
                    <div class="stat-label">Completed</div>
                    <div class="stat-value">${stats.done}</div>
                </div>
            </div>

            <div class="filter-bar">
                <span class="filter-label">Filter:</span>
                <a href="/dashboard/spreadsheet-simple.html" class="filter-btn ${filter === 'all' ? 'active' : ''}">All</a>
                <a href="/dashboard/spreadsheet-simple.html?filter=pending" class="filter-btn ${filter === 'pending' ? 'active' : ''}">Pending</a>
                <a href="/dashboard/spreadsheet-simple.html?filter=processing" class="filter-btn ${filter === 'processing' ? 'active' : ''}">Processing</a>
                <a href="/dashboard/spreadsheet-simple.html?filter=done" class="filter-btn ${filter === 'done' ? 'active' : ''}">Done</a>
                <a href="/dashboard/spreadsheet-simple.html?filter=error" class="filter-btn ${filter === 'error' ? 'active' : ''}">Error</a>
            </div>

            ${emptyStateHtml}
            
            ${rows.length > 0 ? `
            <div class="spreadsheet-container">
                <div class="spreadsheet-header">
                    <div>
                        <h2>Content Queue</h2>
                        <div class="spreadsheet-info">Edit fields and click Save. Each row saves individually.</div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <form method="POST" action="/api/spreadsheet-simple/export" style="display:inline;">
                            <button type="submit" class="btn btn-secondary btn-small">📤 Export</button>
                        </form>
                        <form method="POST" action="/api/spreadsheet-simple/clear" style="display:inline;" onsubmit="return confirm('Are you sure you want to clear ALL data? This cannot be undone.');">
                            <button type="submit" class="btn btn-danger btn-small">🗑️ Clear All</button>
                        </form>
                    </div>
                </div>
                
                <div class="spreadsheet-table-wrapper">
                    <table class="spreadsheet-table">
                        <thead>
                            <tr>
                                <th style="min-width: 180px;">Service URL</th>
                                <th style="min-width: 150px;">Main Keyword</th>
                                <th style="min-width: 200px;">Cluster Keywords</th>
                                <th style="min-width: 150px;">GDocs Link</th>
                                <th style="min-width: 150px;">WP Post URL</th>
                                <th style="min-width: 120px;">Status</th>
                                <th style="min-width: 150px;">Feature Image</th>
                                <th style="min-width: 100px;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
            ` : ''}
            
            <div id="import-section" class="import-section" style="margin-top: 24px;">
                <h3>📥 Import from Google Sheets</h3>
                <p style="color: #666; font-size: 13px; margin-bottom: 12px;">Copy and paste your data below. Supports tab or comma separated values.</p>
                <form method="POST" action="/api/spreadsheet-simple/import">
                    <textarea class="import-textarea" name="data" placeholder="Service URL [tab] Main Keyword [tab] Cluster Keywords [tab] Status
https://example.com [tab] keyword [tab] cluster1, cluster2 [tab] PENDING"></textarea>
                    <div>
                        <button type="submit" class="btn btn-primary">Import Data</button>
                    </div>
                </form>
            </div>
        </main>
    </div>
</body>
</html>`;
        
        res.send(html);
    } catch (err) {
        console.error('Render error:', err);
        res.status(500).send('Error loading spreadsheet');
    }
}

// GET /dashboard/spreadsheet-simple.html - Render the spreadsheet page
router.get('/spreadsheet-simple.html', authenticateToken, async (req, res) => {
    const filter = req.query.filter || 'all';
    const message = req.query.message || '';
    const messageType = req.query.messageType || 'info';
    await renderSpreadsheetPage(req, res, { filter, message, messageType });
});

// POST /api/spreadsheet-simple/import - Import data from pasted TSV/CSV text
router.post('/import', authenticateToken, async (req, res) => {
    try {
        const { data } = req.body;

        if (!data || !data.trim()) {
            return renderSpreadsheetPage(req, res, { 
                message: 'No data provided. Please paste your spreadsheet data.',
                messageType: 'error'
            });
        }

        const trimmedData = data.trim();
        const lines = trimmedData.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
            return renderSpreadsheetPage(req, res, { 
                message: 'No valid data found.',
                messageType: 'error'
            });
        }

        const firstLine = lines[0];
        const delimiter = firstLine.includes('\t') ? '\t' : 
                         firstLine.includes(',') ? ',' : '\t';

        const rawHeaders = firstLine.split(delimiter).map(h => h.trim());

        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const values = line.split(delimiter).map(v => v.trim());
            const rowObj = {};
            
            rawHeaders.forEach((rawHeader, index) => {
                const normalizedHeader = normalizeHeader(rawHeader);
                rowObj[normalizedHeader] = values[index] || '';
            });

            rows.push(rowObj);
        }

        if (rows.length === 0) {
            return renderSpreadsheetPage(req, res, { 
                message: 'No data rows found. Please include at least one row of data.',
                messageType: 'error'
            });
        }

        // Delete existing rows for this user (replace mode)
        if (db.isPostgres) {
            await db.prepare('DELETE FROM spreadsheet_rows WHERE user_id = $1').run(req.user.id);
        } else {
            await db.prepare('DELETE FROM spreadsheet_rows WHERE user_id = ?').run(req.user.id);
        }

        // Insert rows into database
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            
            const serviceUrl = row.service_url || '';
            const mainKeyword = row.main_keyword || '';
            const clusterKeywords = row.cluster_keywords || '';
            const gdocsLink = row.gdocs_link || '';
            const wpPostUrl = row.wp_post_url || '';
            const status = (row.status || 'PENDING').toUpperCase();
            const featureImage = row.feature_image || '';

            if (db.isPostgres) {
                await db.prepare(`
                    INSERT INTO spreadsheet_rows 
                    (user_id, service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image, row_order)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `).run(req.user.id, serviceUrl, mainKeyword, clusterKeywords, gdocsLink, wpPostUrl, status, featureImage, i);
            } else {
                await db.prepare(`
                    INSERT INTO spreadsheet_rows 
                    (user_id, service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image, row_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(req.user.id, serviceUrl, mainKeyword, clusterKeywords, gdocsLink, wpPostUrl, status, featureImage, i);
            }
        }

        return renderSpreadsheetPage(req, res, { 
            message: `Successfully imported ${rows.length} rows`,
            messageType: 'success'
        });

    } catch (err) {
        console.error('Import error:', err);
        return renderSpreadsheetPage(req, res, { 
            message: 'Failed to import data: ' + err.message,
            messageType: 'error'
        });
    }
});

// POST /api/spreadsheet-simple/row - Add a new row
router.post('/row', authenticateToken, async (req, res) => {
    try {
        // Get max row_order
        let orderQuery;
        if (db.isPostgres) {
            orderQuery = 'SELECT MAX(row_order) as max_order FROM spreadsheet_rows WHERE user_id = $1';
        } else {
            orderQuery = 'SELECT MAX(row_order) as max_order FROM spreadsheet_rows WHERE user_id = ?';
        }
        const orderResult = await db.prepare(orderQuery).get(req.user.id);
        const rowOrder = (orderResult?.max_order || 0) + 1;

        if (db.isPostgres) {
            await db.prepare(`
                INSERT INTO spreadsheet_rows 
                (user_id, service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image, row_order)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `).run(req.user.id, '', '', '', '', '', 'PENDING', '', rowOrder);
        } else {
            await db.prepare(`
                INSERT INTO spreadsheet_rows 
                (user_id, service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image, row_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(req.user.id, '', '', '', '', '', 'PENDING', '', rowOrder);
        }

        return res.redirect('/dashboard/spreadsheet-simple.html?message=Row added&messageType=success');

    } catch (err) {
        console.error('Add row error:', err);
        return renderSpreadsheetPage(req, res, { 
            message: 'Failed to add row: ' + err.message,
            messageType: 'error'
        });
    }
});

// POST /api/spreadsheet-simple/save/:id - Save a specific row
router.post('/save/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { service_url, main_keyword, cluster_keywords, gdocs_link, wp_post_url, status, feature_image } = req.body;

        // Verify the row belongs to this user
        let existingRow;
        if (db.isPostgres) {
            existingRow = await db.prepare('SELECT * FROM spreadsheet_rows WHERE id = $1 AND user_id = $2')
                .get(id, req.user.id);
        } else {
            existingRow = await db.prepare('SELECT * FROM spreadsheet_rows WHERE id = ? AND user_id = ?')
                .get(id, req.user.id);
        }

        if (!existingRow) {
            return renderSpreadsheetPage(req, res, { 
                message: 'Row not found',
                messageType: 'error'
            });
        }

        if (db.isPostgres) {
            await db.prepare(`
                UPDATE spreadsheet_rows 
                SET service_url = $1, main_keyword = $2, cluster_keywords = $3, gdocs_link = $4, 
                    wp_post_url = $5, status = $6, feature_image = $7, updated_at = CURRENT_TIMESTAMP
                WHERE id = $8 AND user_id = $9
            `).run(service_url || '', main_keyword || '', cluster_keywords || '', gdocs_link || '', 
                   wp_post_url || '', (status || 'PENDING').toUpperCase(), feature_image || '', id, req.user.id);
        } else {
            await db.prepare(`
                UPDATE spreadsheet_rows 
                SET service_url = ?, main_keyword = ?, cluster_keywords = ?, gdocs_link = ?, 
                    wp_post_url = ?, status = ?, feature_image = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
            `).run(service_url || '', main_keyword || '', cluster_keywords || '', gdocs_link || '', 
                   wp_post_url || '', (status || 'PENDING').toUpperCase(), feature_image || '', id, req.user.id);
        }

        return res.redirect('/dashboard/spreadsheet-simple.html?message=Row saved&messageType=success');

    } catch (err) {
        console.error('Save error:', err);
        return renderSpreadsheetPage(req, res, { 
            message: 'Failed to save row: ' + err.message,
            messageType: 'error'
        });
    }
});

// POST /api/spreadsheet-simple/delete/:id - Delete a specific row
router.post('/delete/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        let result;
        if (db.isPostgres) {
            result = await db.prepare('DELETE FROM spreadsheet_rows WHERE id = $1 AND user_id = $2')
                .run(id, req.user.id);
        } else {
            result = await db.prepare('DELETE FROM spreadsheet_rows WHERE id = ? AND user_id = ?')
                .run(id, req.user.id);
        }

        if (result.changes === 0) {
            return renderSpreadsheetPage(req, res, { 
                message: 'Row not found',
                messageType: 'error'
            });
        }

        return res.redirect('/dashboard/spreadsheet-simple.html?message=Row deleted&messageType=success');

    } catch (err) {
        console.error('Delete error:', err);
        return renderSpreadsheetPage(req, res, { 
            message: 'Failed to delete row: ' + err.message,
            messageType: 'error'
        });
    }
});

// POST /api/spreadsheet-simple/clear - Clear all rows for the current user
router.post('/clear', authenticateToken, async (req, res) => {
    try {
        if (db.isPostgres) {
            await db.prepare('DELETE FROM spreadsheet_rows WHERE user_id = $1').run(req.user.id);
        } else {
            await db.prepare('DELETE FROM spreadsheet_rows WHERE user_id = ?').run(req.user.id);
        }

        return res.redirect('/dashboard/spreadsheet-simple.html?message=All data cleared&messageType=success');

    } catch (err) {
        console.error('Clear error:', err);
        return renderSpreadsheetPage(req, res, { 
            message: 'Failed to clear data: ' + err.message,
            messageType: 'error'
        });
    }
});

// POST /api/spreadsheet-simple/export - Export data as TSV
router.post('/export', authenticateToken, async (req, res) => {
    try {
        let query;
        if (db.isPostgres) {
            query = `SELECT * FROM spreadsheet_rows WHERE user_id = $1 ORDER BY row_order ASC`;
        } else {
            query = `SELECT * FROM spreadsheet_rows WHERE user_id = ? ORDER BY row_order ASC`;
        }

        const rows = await db.prepare(query).all(req.user.id);

        if (rows.length === 0) {
            return renderSpreadsheetPage(req, res, { 
                message: 'No data to export',
                messageType: 'info'
            });
        }

        // Build TSV
        const headers = ['Service URL', 'Main Keyword', 'Cluster Keywords', 'GDocs Link', 
                        'WP Post URL', 'Status', 'Feature Image'];
        
        const lines = [headers.join('\t')];
        
        for (const row of rows) {
            const values = [
                row.service_url || '',
                row.main_keyword || '',
                row.cluster_keywords || '',
                row.gdocs_link || '',
                row.wp_post_url || '',
                row.status || 'PENDING',
                row.feature_image || ''
            ];
            const escapedValues = values.map(v => {
                if (v.includes('\t') || v.includes('\n') || v.includes('"')) {
                    return '"' + v.replace(/"/g, '""') + '"';
                }
                return v;
            });
            lines.push(escapedValues.join('\t'));
        }

        const tsv = lines.join('\n');
        
        // Render page with export section showing the data
        return renderSpreadsheetPage(req, res, { 
            message: 'Exported ' + rows.length + ' rows. Copy the data below:',
            messageType: 'success',
            exportData: tsv
        });

    } catch (err) {
        console.error('Export error:', err);
        return renderSpreadsheetPage(req, res, { 
            message: 'Failed to export data: ' + err.message,
            messageType: 'error'
        });
    }
});

// POST /api/spreadsheet-simple/process/:id - Process a single row (generate article)
router.post('/process/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Get the row
        let row;
        if (db.isPostgres) {
            row = await db.prepare('SELECT * FROM spreadsheet_rows WHERE id = $1 AND user_id = $2')
                .get(id, req.user.id);
        } else {
            row = await db.prepare('SELECT * FROM spreadsheet_rows WHERE id = ? AND user_id = ?')
                .get(id, req.user.id);
        }

        if (!row) {
            return renderSpreadsheetPage(req, res, { 
                message: 'Row not found',
                messageType: 'error'
            });
        }

        const keyword = row.main_keyword;
        if (!keyword) {
            return renderSpreadsheetPage(req, res, { 
                message: 'No main keyword found in this row',
                messageType: 'error'
            });
        }

        // Update status to PROCESSING
        if (db.isPostgres) {
            await db.prepare('UPDATE spreadsheet_rows SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2')
                .run('PROCESSING', id);
        } else {
            await db.prepare('UPDATE spreadsheet_rows SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run('PROCESSING', id);
        }

        // TODO: Trigger content generation via SummonAgent
        // For now, just return success
        return res.redirect('/dashboard/spreadsheet-simple.html?message=Started processing: ' + encodeURIComponent(keyword) + '&messageType=success');

    } catch (err) {
        console.error('Process error:', err);
        return renderSpreadsheetPage(req, res, { 
            message: 'Failed to process row: ' + err.message,
            messageType: 'error'
        });
    }
});

// API endpoints for JSON responses (for backward compatibility)
router.get('/data', authenticateToken, async (req, res) => {
    try {
        const { status, sortBy = 'row_order', sortOrder = 'asc' } = req.query;

        let query;
        let params;

        const validSortColumns = ['row_order', 'created_at', 'main_keyword', 'status'];
        const orderBy = validSortColumns.includes(sortBy) ? sortBy : 'row_order';
        const orderDir = sortOrder.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

        if (status) {
            if (db.isPostgres) {
                query = `SELECT * FROM spreadsheet_rows WHERE user_id = $1 AND status = $2 ORDER BY ${orderBy} ${orderDir}`;
                params = [req.user.id, status.toUpperCase()];
            } else {
                query = `SELECT * FROM spreadsheet_rows WHERE user_id = ? AND status = ? ORDER BY ${orderBy} ${orderDir}`;
                params = [req.user.id, status.toUpperCase()];
            }
        } else {
            if (db.isPostgres) {
                query = `SELECT * FROM spreadsheet_rows WHERE user_id = $1 ORDER BY ${orderBy} ${orderDir}`;
                params = [req.user.id];
            } else {
                query = `SELECT * FROM spreadsheet_rows WHERE user_id = ? ORDER BY ${orderBy} ${orderDir}`;
                params = [req.user.id];
            }
        }

        const rows = await db.prepare(query).all(...params);

        let statsQuery;
        if (db.isPostgres) {
            statsQuery = `SELECT status, COUNT(*) as count FROM spreadsheet_rows WHERE user_id = $1 GROUP BY status`;
        } else {
            statsQuery = `SELECT status, COUNT(*) as count FROM spreadsheet_rows WHERE user_id = ? GROUP BY status`;
        }
        const statsRows = await db.prepare(statsQuery).all(req.user.id);
        
        const stats = {
            total: rows.length,
            pending: 0,
            processing: 0,
            done: 0,
            error: 0
        };
        
        statsRows.forEach(s => {
            const statusLower = s.status.toLowerCase();
            if (statusLower === 'pending') stats.pending = s.count;
            else if (statusLower === 'processing') stats.processing = s.count;
            else if (['done', 'completed', 'success', 'published'].includes(statusLower)) stats.done = s.count;
            else if (['error', 'failed'].includes(statusLower)) stats.error = s.count;
        });

        res.json({
            success: true,
            data: { rows, stats }
        });

    } catch (err) {
        console.error('Get data error:', err);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve data: ' + err.message
        });
    }
});

module.exports = router;
