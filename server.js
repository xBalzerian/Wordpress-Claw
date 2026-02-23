require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { google } = require('googleapis');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage (replace with database in production)
const users = new Map();
const sessions = new Map();

// ========== KIMI/LAOZHANG AI INTEGRATION ==========
const LAOZHANG_API_KEY = process.env.LAOZHANG_API_KEY || 'sk-cPzX75qEIsFhSLiVEeAc075bFbE54b3b8cD716A56aB74646';
const LAOZHANG_API_URL = 'https://api.laozhang.ai/v1/chat/completions';

async function askOpus(messages, model = 'claude-opus-4-6-thinking') {
    try {
        const response = await axios.post(LAOZHANG_API_URL, {
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 4000
        }, {
            headers: {
                'Authorization': `Bearer ${LAOZHANG_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Opus API error:', error.response?.data || error.message);
        throw error;
    }
}

// ========== GOOGLE SERVICE ACCOUNT SETUP ==========
// New method: Service Account (no OAuth needed)
function getServiceAccountAuth() {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
        return null;
    }
    try {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
        return new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets.readonly',
                'https://www.googleapis.com/auth/spreadsheets'
            ]
        });
    } catch (e) {
        console.error('Failed to parse service account key:', e);
        return null;
    }
}

// ========== GOOGLE SHEETS INTEGRATION ==========
// Method 1: Service Account (preferred - no OAuth needed)
async function readSheetWithServiceAccount(spreadsheetId, range = 'A1:Z1000') {
    const auth = getServiceAccountAuth();
    if (!auth) {
        throw new Error('Service account not configured');
    }
    
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range
    });
    return response.data.values;
}

async function writeSheetWithServiceAccount(spreadsheetId, range, values) {
    const auth = getServiceAccountAuth();
    if (!auth) {
        throw new Error('Service account not configured');
    }
    
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        resource: { values }
    });
}

// Method 2: OAuth (legacy - for backward compatibility)
async function getGoogleSheetsClient(accessToken) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    return google.sheets({ version: 'v4', auth });
}

async function readSheet(accessToken, spreadsheetId, range = 'A1:Z1000') {
    const sheets = await getGoogleSheetsClient(accessToken);
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range
    });
    return response.data.values;
}

// ========== GITHUB INTEGRATION ==========
function getGitHubClient(token) {
    return new Octokit({ auth: token });
}

async function uploadImageToGitHub(token, owner, repo, path, content, message) {
    const octokit = getGitHubClient(token);
    
    // Check if file exists
    let sha;
    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path });
        sha = data.sha;
    } catch (e) {
        // File doesn't exist, that's fine
    }
    
    // Create or update file
    const { data } = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
        sha
    });
    
    return data.content.download_url;
}

// ========== WORDPRESS INTEGRATION ==========
async function publishToWordPress(siteUrl, username, appPassword, post) {
    const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
    
    const response = await axios.post(`${siteUrl}/wp-json/wp/v2/posts`, {
        title: post.title,
        content: post.content,
        status: 'publish',
        categories: post.categories || [],
        tags: post.tags || [],
        featured_media: post.featuredImageId || 0,
        meta: {
            _yoast_wpseo_title: post.seoTitle || post.title,
            _yoast_wpseo_metadesc: post.seoDescription || '',
            _yoast_wpseo_focuskw: post.focusKeyword || ''
        }
    }, {
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
        }
    });
    
    return response.data;
}

async function uploadImageToWordPress(siteUrl, username, appPassword, imageBuffer, filename) {
    const auth = Buffer.from(`${username}:${appPassword}`).toString('base64');
    
    const formData = new FormData();
    formData.append('file', new Blob([imageBuffer]), filename);
    
    const response = await axios.post(`${siteUrl}/wp-json/wp/v2/media`, formData, {
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'multipart/form-data'
        }
    });
    
    return response.data.id;
}

// ========== AUTH MIDDLEWARE ==========
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = users.get(token);
    if (!user) {
        // Create demo user
        const newUser = {
            id: token,
            token,
            businessProfile: {},
            connections: {},
            createdAt: new Date()
        };
        users.set(token, newUser);
        req.user = newUser;
    } else {
        req.user = user;
    }
    
    next();
}

// ========== ROUTES ==========

// Health check
app.get('/', (req, res) => {
    res.json({ status: 'WordPress Claw API is running', version: '1.0.0' });
});

// ClawBot - Spawn session
app.post('/api/clawbot/spawn', authMiddleware, async (req, res) => {
    const sessionKey = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const systemPrompt = `You are ClawBot, an AI assistant for WordPress Claw - a content automation platform.

Your user has the following ecosystem:
- Business Profile: ${JSON.stringify(req.user.businessProfile)}
- Connected Services: ${JSON.stringify(req.user.connections)}

You can help with:
1. Reading topics from Google Sheets
2. Generating SEO-optimized articles
3. Creating image prompts
4. Publishing to WordPress
5. Managing content workflows

Always be helpful, concise, and action-oriented. If the user asks you to perform an action (like "create 5 articles"), acknowledge it and explain the steps you'll take.`;

    sessions.set(sessionKey, {
        userId: req.user.id,
        messages: [{ role: 'system', content: systemPrompt }],
        createdAt: new Date()
    });
    
    res.json({ sessionKey, status: 'ready' });
});

// ClawBot - Send message
app.post('/api/clawbot/message', authMiddleware, async (req, res) => {
    const { message, sessionKey } = req.body;
    
    if (!sessions.has(sessionKey)) {
        return res.status(400).json({ error: 'Invalid session' });
    }
    
    const session = sessions.get(sessionKey);
    session.messages.push({ role: 'user', content: message });
    
    try {
        // Check for action commands
        const lowerMsg = message.toLowerCase();
        let response;
        
        if (lowerMsg.includes('read sheet') || lowerMsg.includes('get topics')) {
            response = await handleReadSheet(req.user);
        } else if (lowerMsg.includes('create article') || lowerMsg.includes('generate content')) {
            response = await handleCreateArticle(req.user, message);
        } else if (lowerMsg.includes('publish') || lowerMsg.includes('post to wordpress')) {
            response = await handlePublish(req.user, message);
        } else if (lowerMsg.includes('status') || lowerMsg.includes('check')) {
            response = await handleStatusCheck(req.user);
        } else {
            // Regular chat with Opus
            response = await askOpus(session.messages);
        }
        
        session.messages.push({ role: 'assistant', content: response });
        
        // Keep only last 20 messages
        if (session.messages.length > 20) {
            session.messages = [session.messages[0], ...session.messages.slice(-19)];
        }
        
        res.json({ response });
    } catch (error) {
        console.error('ClawBot error:', error);
        res.status(500).json({ error: 'Failed to process message', details: error.message });
    }
});

// Action handlers
async function handleReadSheet(user) {
    if (!user.connections?.sheets?.connected) {
        return "❌ Google Sheets is not connected. Please connect your spreadsheet first in the Connections tab.";
    }
    
    const sheetId = user.connections.sheets.sheetId;
    
    // Try Service Account first (new method)
    try {
        const data = await readSheetWithServiceAccount(sheetId, 'A1:Z1000');
        return formatSheetData(data);
    } catch (serviceAccountError) {
        console.log('Service account failed:', serviceAccountError.message);
        
        // Fallback to OAuth if available (legacy method)
        if (user.connections?.sheets?.accessToken) {
            try {
                const data = await readSheet(user.connections.sheets.accessToken, sheetId, 'A1:Z1000');
                return formatSheetData(data);
            } catch (oauthError) {
                console.log('OAuth fallback failed:', oauthError.message);
            }
        }
        
        // If both fail, guide user to share sheet
        return `⚠️ I can't access your spreadsheet yet.

**To fix this, you need to share your sheet with ClawBot:**

1. Open your Google Sheet
2. Click **Share** (top right)
3. Add this email: **${process.env.SERVICE_ACCOUNT_EMAIL || 'wordpress-claw@your-project.iam.gserviceaccount.com'}**
4. Give **Editor** permission
5. Click **Send**

Once shared, I can read your topics and images!`;
    }
}

function formatSheetData(data) {
    if (!data || data.length === 0) {
        return "Your spreadsheet is empty. Please add some topics!";
    }
    
    // Analyze the data
    const headers = data[0];
    const rows = data.slice(1);
    
    // Find image column (common names)
    const imageColIndex = headers.findIndex(h => 
        h.toLowerCase().includes('image') || 
        h.toLowerCase().includes('img') ||
        h.toLowerCase().includes('photo')
    );
    
    const imageCount = imageColIndex >= 0 
        ? rows.filter(r => r[imageColIndex] && r[imageColIndex].trim() !== '').length 
        : 0;
    
    const totalRows = rows.length;
    
    return `📊 **Spreadsheet Analysis**

**Headers:** ${headers.join(', ')}
**Total Topics:** ${totalRows}
**Images Found:** ${imageCount}

**First few topics:**
${rows.slice(0, 5).map((r, i) => `${i+1}. ${r[0] || 'Untitled'}`).join('\n')}
${rows.length > 5 ? `\n... and ${rows.length - 5} more` : ''}

Would you like me to:
• Read a specific topic in detail?
• Check which articles are ready to publish?
• Generate content for a topic?`;
}

async function handleCreateArticle(user, message) {
    const match = message.match(/(\d+)\s*article/i);
    const count = match ? parseInt(match[1]) : 1;
    
    if (!user.businessProfile?.company_name) {
        return "I need your business profile first. Please tell me about your company in the Business Profile tab.";
    }
    
    return `I'll create ${count} SEO-optimized article(s) for you. Here's my plan:

1. **Research** - Analyze your business profile and target keywords
2. **Outline** - Create article structure with H2s and H3s
3. **Write** - Generate ${count}000+ word article with your brand voice
4. **Images** - Create ${count * 2} AI-generated images
5. **SEO** - Add meta tags, schema markup, internal links

Your business: ${user.businessProfile.company_name}
Industry: ${user.businessProfile.industry || 'Not specified'}

Ready to proceed? Just say "yes" and I'll start generating!`;
}

async function handlePublish(user, message) {
    if (!user.connections?.wordpress?.connected) {
        return "WordPress is not connected. Please connect your WordPress site in the Connections tab first.";
    }
    
    return `I can publish to your WordPress site: ${user.connections.wordpress.siteUrl}

Publishing workflow:
1. Upload images to WordPress media library
2. Create post with SEO optimization
3. Set featured image
4. Add categories and tags
5. Publish or save as draft

Would you like me to publish now?`;
}

async function handleStatusCheck(user) {
    const connections = user.connections || {};
    const profile = user.businessProfile || {};
    
    const profileFields = ['company_name', 'industry', 'description', 'target_audience', 'tone'];
    const filledFields = profileFields.filter(f => profile[f]);
    const profilePercent = Math.round((filledFields.length / profileFields.length) * 100);
    
    return `📊 **Your Ecosystem Status**

**Business Profile:** ${profilePercent}% complete
${filledFields.map(f => `✅ ${f}`).join('\n')}
${profileFields.filter(f => !profile[f]).map(f => `⬜ ${f}`).join('\n')}

**Connections:**
${connections.sheets?.connected ? '✅ Google Sheets' : '⬜ Google Sheets'}
${connections.github?.connected ? '✅ GitHub' : '⬜ GitHub'}
${connections.wordpress?.connected ? '✅ WordPress' : '⬜ WordPress'}

**Next Steps:**
${profilePercent < 100 ? '1. Complete your business profile' : ''}
${!connections.sheets?.connected ? '2. Connect Google Sheets' : ''}
${!connections.github?.connected ? '3. Connect GitHub' : ''}
${!connections.wordpress?.connected ? '4. Connect WordPress' : '✅ Ready to create content!'}`;
}

// User routes
app.get('/api/user/profile', authMiddleware, (req, res) => {
    res.json({
        businessProfile: req.user.businessProfile,
        connections: req.user.connections
    });
});

app.post('/api/user/profile', authMiddleware, (req, res) => {
    req.user.businessProfile = { ...req.user.businessProfile, ...req.body };
    res.json({ success: true, profile: req.user.businessProfile });
});

app.post('/api/user/connections', authMiddleware, (req, res) => {
    req.user.connections = { ...req.user.connections, ...req.body };
    res.json({ success: true, connections: req.user.connections });
});

// ========== GOOGLE OAUTH ROUTES (Legacy - optional) ==========

// Get Service Account email for sharing
app.get('/api/sheets/service-account', (req, res) => {
    try {
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
            const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
            res.json({ 
                email: credentials.client_email,
                method: 'service_account'
            });
        } else {
            res.json({ 
                email: null,
                method: 'oauth',
                message: 'Service account not configured. Use OAuth instead.'
            });
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to get service account info' });
    }
});

// Initiate Google OAuth (legacy method)
app.get('/api/auth/google', (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
    });
    res.redirect(authUrl);
});

// Google OAuth callback
app.get('/api/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
        return res.status(400).json({ error: 'No authorization code provided' });
    }
    
    try {
        const { tokens } = await oauth2Client.getToken(code);
        
        // Store tokens with user (in production, use a database)
        // For now, we'll redirect to frontend with the tokens
        const tokenData = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token, // Important for long-term access
            expiry_date: tokens.expiry_date
        };
        
        const tokenParam = encodeURIComponent(JSON.stringify(tokenData));
        res.redirect(`https://xbalzerian.github.io/Wordpress-Claw/frontend/dashboard/connections.html?google_auth=success&tokens=${tokenParam}`);
    } catch (error) {
        console.error('Google OAuth error:', error);
        res.redirect(`https://xbalzerian.github.io/Wordpress-Claw/frontend/dashboard/connections.html?google_auth=error&message=${encodeURIComponent(error.message)}`);
    }
});

// Store Google token after OAuth
app.post('/api/auth/google/token', authMiddleware, (req, res) => {
    const { accessToken, refreshToken, expiryDate } = req.body;
    
    if (!req.user.connections) {
        req.user.connections = {};
    }
    if (!req.user.connections.sheets) {
        req.user.connections.sheets = {};
    }
    
    req.user.connections.sheets.accessToken = accessToken;
    req.user.connections.sheets.refreshToken = refreshToken;
    req.user.connections.sheets.expiryDate = expiryDate;
    req.user.connections.sheets.connected = true;
    req.user.connections.sheets.authenticated = true;
    
    res.json({ 
        success: true, 
        message: 'Google authentication stored for user',
        connections: req.user.connections
    });
});

// GitHub OAuth callback
app.get('/api/auth/github/callback', async (req, res) => {
    const { code, state } = req.query;
    // Handle OAuth callback
    res.redirect('/dashboard/connections.html?github=connected');
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 WordPress Claw API running on port ${PORT}`);
    console.log(`🤖 Opus AI integration: ${LAOZHANG_API_KEY ? 'Enabled' : 'Disabled'}`);
});
