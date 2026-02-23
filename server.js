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

async function askKimi(messages, model = 'kimi-k2-5') {
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
        console.error('Kimi API error:', error.response?.data || error.message);
        throw error;
    }
}

// ========== GOOGLE SHEETS INTEGRATION ==========
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

async function writeSheet(accessToken, spreadsheetId, range, values) {
    const sheets = await getGoogleSheetsClient(accessToken);
    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        resource: { values }
    });
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
            // Regular chat with Kimi
            response = await askKimi(session.messages);
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
        return "Google Sheets is not connected. Please connect your spreadsheet first in the Connections tab.";
    }
    
    try {
        // This would actually read from the sheet
        return `I can see your Google Sheets is connected (${user.connections.sheets.sheetId}). 

To read actual data, I need you to provide Google OAuth access. In the meantime, here's what I can do once connected:
- Read all topics from your sheet
- Check which articles are pending
- Update status after publishing

Would you like me to help you set up the Google OAuth flow?`;
    } catch (error) {
        return `Error reading sheet: ${error.message}`;
    }
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

// Google Sheets OAuth callback
app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state } = req.query;
    // Handle OAuth callback
    res.redirect('/dashboard/connections.html?google=connected');
});

// GitHub OAuth callback
app.get('/api/auth/github/callback', async (req, res) => {
    const { code, state } = req.query;
    // Handle OAuth callback
    res.redirect('/dashboard/connections.html?github=connected');
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 WordPress Claw API running on port ${PORT}`);
    console.log(`🤖 Kimi AI integration: ${LAOZHANG_API_KEY ? 'Enabled' : 'Disabled'}`);
});
