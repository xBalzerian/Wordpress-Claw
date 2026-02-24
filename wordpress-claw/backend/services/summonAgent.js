const { generateContent, generateImagePrompt } = require('./contentGeneration');
const { generateFeaturedImage } = require('./imageGeneration');
const { researchKeyword, getContentIdeas } = require('./research');
const { uploadImage } = require('./github');
const { publishToWordPress } = require('./wordpress');
const db = require('../database/db');

/**
 * SummonAgent - The main AI orchestrator for ClawBot
 * Handles content creation workflow from research to publication
 */
class SummonAgent {
    constructor(userId) {
        this.userId = userId;
        this.context = null;
        this.workflowState = null;
    }

    /**
     * Initialize agent with user context
     */
    async initialize() {
        this.context = await this.buildUserContext();
        return this.context;
    }

    /**
     * Build comprehensive user context
     */
    async buildUserContext() {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(this.userId);
        const businessProfile = db.prepare('SELECT * FROM business_profiles WHERE user_id = ?').get(this.userId);
        const connections = db.prepare('SELECT type, status FROM connections WHERE user_id = ?').all(this.userId);
        const articleCount = db.prepare('SELECT COUNT(*) as count FROM articles WHERE user_id = ?').get(this.userId);
        const recentArticles = db.prepare(
            'SELECT title, keyword, status, created_at FROM articles WHERE user_id = ? ORDER BY created_at DESC LIMIT 5'
        ).all(this.userId);

        const creditsAvailable = user?.tier === 'pro' 
            ? 'unlimited' 
            : Math.max(0, (user?.credits_included || 0) - (user?.credits_used || 0));

        return {
            user: {
                id: this.userId,
                name: user?.name,
                email: user?.email,
                tier: user?.tier || 'free',
                creditsAvailable,
                creditsUsed: user?.credits_used || 0
            },
            businessProfile: businessProfile || null,
            connections: connections || [],
            stats: {
                totalArticles: articleCount?.count || 0,
                recentArticles: recentArticles || []
            },
            readiness: this.calculateReadiness(businessProfile, connections)
        };
    }

    /**
     * Calculate user readiness for content creation
     */
    calculateReadiness(businessProfile, connections) {
        const checks = {
            hasBusinessProfile: !!(businessProfile?.company_name && businessProfile?.industry),
            hasWordPress: connections.some(c => c.type === 'wordpress' && c.status === 'active'),
            hasGitHub: connections.some(c => c.type === 'github' && c.status === 'active'),
            hasKeywords: !!(businessProfile?.keywords)
        };

        const ready = checks.hasBusinessProfile && checks.hasWordPress;
        const missing = [];

        if (!checks.hasBusinessProfile) missing.push('business profile');
        if (!checks.hasWordPress) missing.push('WordPress connection');
        if (!checks.hasKeywords) missing.push('target keywords');

        return {
            ready,
            checks,
            missing,
            canGenerate: checks.hasBusinessProfile,
            canPublish: checks.hasWordPress
        };
    }

    /**
     * Get proactive greeting based on user state
     */
    getProactiveGreeting() {
        const { readiness, user } = this.context;

        if (!readiness.checks.hasBusinessProfile) {
            return {
                type: 'onboarding_needed',
                message: `Hey there! I'm ClawBot, your AI content strategist. 👋\n\nI see you haven't completed your business profile yet. Let's get that set up first so I can create content that truly represents your brand.`,
                actions: [{
                    type: 'navigate',
                    label: 'Complete Business Profile',
                    params: { path: '/dashboard/business-profile.html' }
                }],
                suggestions: ['What info do you need?', 'Why is this important?', 'Help me get started']
            };
        }

        if (!readiness.checks.hasWordPress) {
            return {
                type: 'connection_needed',
                message: `Welcome back! 🎉\n\nYour business profile looks great. To publish content directly to your website, you'll need to connect your WordPress site.`,
                actions: [{
                    type: 'navigate',
                    label: 'Connect WordPress',
                    params: { path: '/dashboard/connections.html' }
                }],
                suggestions: ['How do I connect WordPress?', 'Is it secure?', 'What about GitHub?']
            };
        }

        if (!readiness.checks.hasKeywords) {
            return {
                type: 'keywords_needed',
                message: `Ready to create some amazing content! 🚀\n\nWhat keywords or topics do you want to rank for? I can help you research competitors and create SEO-optimized articles.`,
                actions: [{
                    type: 'start_content_workflow',
                    label: 'Start Content Creation',
                    params: { step: 'research' }
                }],
                suggestions: ['How does this work?', 'What keywords should I target?', 'Show me content ideas']
            };
        }

        // Fully ready
        return {
            type: 'ready',
            message: `Ready to dominate the search rankings! 💪\n\nI'm all set up with your business profile and WordPress connection. What content would you like to create today?`,
            actions: [{
                type: 'start_content_workflow',
                label: 'Create New Article',
                params: { step: 'research' }
            }],
            suggestions: [
                'I want to rank for...',
                'Generate content ideas',
                'Check my past articles',
                `I have ${user.creditsAvailable} credits remaining`
            ]
        };
    }

    /**
     * Start content creation workflow
     */
    async startContentWorkflow(keyword, options = {}) {
        this.workflowState = {
            step: 'research',
            keyword,
            options,
            data: {}
        };

        // Step 1: Research
        const researchResult = await this.researchContent(keyword);
        
        if (!researchResult.success) {
            return {
                success: false,
                step: 'research',
                error: researchResult.error,
                message: `I had trouble researching "${keyword}". Would you like to try again or proceed without research?`
            };
        }

        this.workflowState.data.research = researchResult.data;

        return {
            success: true,
            step: 'strategy',
            message: this.formatResearchSummary(researchResult.data),
            data: researchResult.data,
            actions: [
                {
                    type: 'approve_strategy',
                    label: 'Yes, Create This Article',
                    params: { keyword, wordCount: researchResult.data.insights.targetWordCount }
                },
                {
                    type: 'modify_strategy',
                    label: 'Adjust Parameters',
                    params: { step: 'modify' }
                }
            ],
            suggestions: [
                'Make it longer',
                'Focus on different angle',
                'Show me content ideas',
                'Research different keyword'
            ]
        };
    }

    /**
     * Research content for keyword
     */
    async researchContent(keyword) {
        const { researchKeyword } = require('./research');
        return await researchKeyword(keyword);
    }

    /**
     * Format research summary for user
     */
    formatResearchSummary(data) {
        const { analysis, insights, recommendations } = data;
        
        let summary = `📊 **Research Complete for "${data.keyword}"**\n\n`;
        
        summary += `**Competitor Analysis:**\n`;
        summary += `• Average word count: ${analysis.avgWordCount} words\n`;
        summary += `• Content difficulty: ${analysis.difficulty.toUpperCase()}\n`;
        summary += `• User intent: ${analysis.userIntent}\n\n`;
        
        summary += `**Strategy Recommendation:**\n`;
        summary += `• Target length: ${insights.targetWordCount}+ words\n`;
        summary += `• Content type: ${insights.contentType}\n`;
        summary += `• Key topics: ${insights.keyTopics.slice(0, 3).join(', ')}\n\n`;
        
        if (insights.missingTopics.length > 0) {
            summary += `**Content Gaps to Fill:**\n`;
            summary += `• ${insights.missingTopics.slice(0, 3).join('\n• ')}\n\n`;
        }
        
        summary += `I'll create a comprehensive, SEO-optimized article that outperforms the competition. Ready to proceed?`;
        
        return summary;
    }

    /**
     * Generate article content
     */
    async generateArticle(keyword, options = {}) {
        this.workflowState.step = 'create';

        const { generateContent } = require('./contentGeneration');
        const businessProfile = this.context.businessProfile;
        const researchData = this.workflowState.data?.research?.data || null;

        try {
            const generated = await generateContent({
                keyword,
                businessProfile,
                customPrompt: options.customPrompt,
                userId: this.userId,
                articleId: options.articleId,
                researchData
            });

            this.workflowState.data.generated = generated;

            return {
                success: true,
                step: 'create_complete',
                message: `✅ Article generated successfully!\n\n**"${generated.title}"**\n\nMeta Title: ${generated.metaTitle}\nMeta Description: ${generated.metaDescription}\n\nThe article is ${generated.content.split(/\s+/).length} words and includes SEO optimization, FAQ section, and call-to-action.`,
                data: generated,
                actions: [
                    {
                        type: 'generate_image',
                        label: 'Generate Featured Image',
                        params: { keyword, title: generated.title }
                    },
                    {
                        type: 'save_article',
                        label: 'Save as Draft',
                        params: { status: 'draft' }
                    },
                    {
                        type: 'publish_now',
                        label: 'Publish to WordPress',
                        params: { status: 'publish' }
                    }
                ],
                suggestions: ['Edit content', 'Regenerate', 'Generate image first', 'Change tone']
            };
        } catch (err) {
            return {
                success: false,
                step: 'create_failed',
                error: err.message,
                message: `I encountered an error generating the article: ${err.message}. Would you like to try again?`
            };
        }
    }

    /**
     * Generate featured image for article
     */
    async generateFeaturedImage(keyword, title) {
        try {
            // First generate image prompt
            const { generateImagePrompt } = require('./contentGeneration');
            const imagePrompt = await generateImagePrompt(title, keyword, this.context.businessProfile);

            // Generate the image
            const { generateFeaturedImage: generateImage } = require('./imageGeneration');
            const imageResult = await generateImage({
                prompt: imagePrompt,
                articleTitle: title,
                keyword
            });

            this.workflowState.data.image = imageResult;

            return {
                success: true,
                step: 'image_generated',
                message: `🎨 Featured image generated successfully!`,
                data: imageResult,
                actions: [
                    {
                        type: 'upload_image',
                        label: 'Upload to GitHub',
                        params: {}
                    },
                    {
                        type: 'regenerate_image',
                        label: 'Generate Different Image',
                        params: { keyword, title }
                    }
                ]
            };
        } catch (err) {
            return {
                success: false,
                step: 'image_failed',
                error: err.message,
                message: `Image generation failed: ${err.message}. You can proceed without an image or try again.`
            };
        }
    }

    /**
     * Upload image to GitHub
     */
    async uploadImageToGitHub(imageBuffer, filename) {
        try {
            const githubConnection = db.prepare(
                'SELECT * FROM connections WHERE user_id = ? AND type = ? AND status = ?'
            ).get(this.userId, 'github', 'active');

            if (!githubConnection) {
                return {
                    success: false,
                    error: 'No GitHub connection found',
                    message: 'Please connect your GitHub account first to host images.'
                };
            }

            const credentials = JSON.parse(githubConnection.credentials);
            const { uploadImage } = require('./github');

            const uploadResult = await uploadImage({
                imageBuffer,
                filename,
                mimeType: 'image/png',
                credentials
            });

            this.workflowState.data.imageUrl = uploadResult.url;

            return {
                success: true,
                step: 'image_uploaded',
                message: `📤 Image uploaded successfully!`,
                data: { url: uploadResult.url },
                actions: [
                    {
                        type: 'publish_article',
                        label: 'Publish to WordPress',
                        params: {}
                    }
                ]
            };
        } catch (err) {
            return {
                success: false,
                step: 'upload_failed',
                error: err.message
            };
        }
    }

    /**
     * Save article to database
     */
    async saveArticle(contentData, imageUrl = null) {
        try {
            const result = db.prepare(`
                INSERT INTO articles 
                (user_id, title, content, excerpt, keyword, status, meta_title, meta_description, 
                 tags, featured_image_url, credits_used, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `).run(
                this.userId,
                contentData.title,
                contentData.content,
                contentData.excerpt,
                contentData.focusKeyword,
                'review',
                contentData.metaTitle,
                contentData.metaDescription,
                contentData.tags,
                imageUrl,
                1
            );

            const articleId = result.lastInsertRowid;

            // Deduct credit if not pro
            if (this.context.user.tier !== 'pro') {
                db.prepare('UPDATE users SET credits_used = credits_used + 1 WHERE id = ?').run(this.userId);
            }

            // Log activity
            db.prepare(`
                INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                VALUES (?, ?, ?, ?, ?)
            `).run(this.userId, 'generated', 'article', articleId, JSON.stringify({
                title: contentData.title,
                keyword: contentData.focusKeyword
            }));

            this.workflowState.data.articleId = articleId;

            return {
                success: true,
                step: 'saved',
                articleId,
                message: `💾 Article saved successfully!`,
                actions: [
                    {
                        type: 'publish_article',
                        label: 'Publish to WordPress',
                        params: { articleId }
                    },
                    {
                        type: 'view_article',
                        label: 'View Article',
                        params: { articleId }
                    }
                ]
            };
        } catch (err) {
            return {
                success: false,
                step: 'save_failed',
                error: err.message
            };
        }
    }

    /**
     * Publish article to WordPress
     */
    async publishToWordPress(articleId) {
        try {
            // Get article
            const article = db.prepare('SELECT * FROM articles WHERE id = ? AND user_id = ?')
                .get(articleId, this.userId);

            if (!article) {
                return {
                    success: false,
                    error: 'Article not found'
                };
            }

            // Get WordPress connection
            const wpConnection = db.prepare(
                'SELECT * FROM connections WHERE user_id = ? AND type = ? AND status = ?'
            ).get(this.userId, 'wordpress', 'active');

            if (!wpConnection) {
                return {
                    success: false,
                    error: 'No WordPress connection',
                    message: 'Please connect your WordPress site first.'
                };
            }

            const credentials = JSON.parse(wpConnection.credentials);
            const { publishToWordPress: publishWP } = require('./wordpress');

            const publishResult = await publishWP({
                article,
                credentials
            });

            // Update article status
            db.prepare(`
                UPDATE articles 
                SET status = ?, wp_post_id = ?, wp_url = ?, published_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `).run('published', publishResult.postId, publishResult.url, articleId);

            // Log activity
            db.prepare(`
                INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
                VALUES (?, ?, ?, ?, ?)
            `).run(this.userId, 'published', 'article', articleId, JSON.stringify({
                wpUrl: publishResult.url
            }));

            return {
                success: true,
                step: 'published',
                message: `🎉 Article published successfully!\n\n**Live URL:** ${publishResult.url}`,
                data: {
                    articleId,
                    wpUrl: publishResult.url,
                    wpPostId: publishResult.postId
                },
                actions: [
                    {
                        type: 'view_live',
                        label: 'View Live Article',
                        params: { url: publishResult.url }
                    },
                    {
                        type: 'create_another',
                        label: 'Create Another Article',
                        params: {}
                    }
                ]
            };
        } catch (err) {
            return {
                success: false,
                step: 'publish_failed',
                error: err.message,
                message: `Failed to publish: ${err.message}`
            };
        }
    }

    /**
     * Get content ideas for user
     */
    async getContentIdeas(seedKeyword = null) {
        const { getContentIdeas: getIdeas } = require('./research');
        
        const keywords = seedKeyword 
            ? [seedKeyword]
            : (this.context.businessProfile?.keywords || '').split(',').map(k => k.trim()).filter(k => k);

        if (keywords.length === 0) {
            return {
                success: false,
                message: 'Please provide a keyword or set up your target keywords in your business profile.'
            };
        }

        const allIdeas = [];
        for (const keyword of keywords.slice(0, 3)) {
            const ideas = await getIdeas(keyword, 5);
            allIdeas.push(...ideas.map(idea => ({ idea, basedOn: keyword })));
        }

        return {
            success: true,
            message: `💡 Here are some content ideas based on your keywords:\n\n${allIdeas.map((item, i) => `${i + 1}. ${item.idea}`).join('\n')}`,
            data: allIdeas,
            actions: allIdeas.slice(0, 3).map((item, i) => ({
                type: 'start_content_workflow',
                label: `Create: ${item.idea.substring(0, 40)}...`,
                params: { keyword: item.idea }
            }))
        };
    }

    /**
     * Process user message and determine intent
     */
    async processMessage(message, sessionContext = {}) {
        const lowerMessage = message.toLowerCase();

        // Spreadsheet commands
        if (lowerMessage.includes('spreadsheet') || lowerMessage.includes('my sheet') || 
            lowerMessage.includes('google sheet') || lowerMessage.includes('check sheet')) {
            return this.handleSpreadsheetIntent(message, lowerMessage);
        }

        // Content creation intent
        if (lowerMessage.includes('rank for') || lowerMessage.includes('write about') || 
            lowerMessage.includes('create article') || lowerMessage.includes('generate content')) {
            
            const keywordMatch = message.match(/(?:rank for|write about|create article about|generate content for)[\s:]*["']?(.+?)["']?(?:\?|$|\n)/i);
            const keyword = keywordMatch ? keywordMatch[1].trim() : null;

            if (keyword) {
                return await this.startContentWorkflow(keyword);
            }

            return {
                type: 'clarify',
                message: 'I\'d love to help you create content! What keyword or topic would you like to rank for?',
                suggestions: ['best coffee shop in Manila', 'digital marketing tips', 'SEO strategies 2024']
            };
        }

        // Content ideas intent
        if (lowerMessage.includes('content ideas') || lowerMessage.includes('topic ideas') || 
            lowerMessage.includes('what should i write')) {
            return await this.getContentIdeas();
        }

        // Publish intent
        if (lowerMessage.includes('publish') || lowerMessage.includes('post to wordpress')) {
            return this.handlePublishIntent();
        }

        // Check status intent
        if (lowerMessage.includes('my credits') || lowerMessage.includes('subscription') || 
            lowerMessage.includes('my plan')) {
            return this.handleStatusIntent();
        }

        // Help intent
        if (lowerMessage.includes('help') || lowerMessage.includes('what can you do') || 
            lowerMessage.includes('how do you work')) {
            return this.handleHelpIntent();
        }

        // Default response
        return {
            type: 'general',
            message: `I'm here to help you create SEO-optimized content that ranks! I can:\n\n📝 Research keywords and competitors\n✍️ Generate comprehensive articles\n🎨 Create featured images\n🚀 Publish directly to WordPress\n📊 Check your spreadsheet for topics\n\nWhat would you like to do today?`,
            suggestions: ['I want to rank for...', 'Show me content ideas', 'Check my spreadsheet', 'How does this work?']
        };
    }

    /**
     * Handle spreadsheet-related intents
     */
    handleSpreadsheetIntent(message, lowerMessage) {
        const hasGoogleSheets = this.context.connections.some(c => c.type === 'googlesheets' && c.status === 'active');

        if (!hasGoogleSheets) {
            return {
                type: 'spreadsheet_not_connected',
                message: `📊 You don't have a Google Sheets connection yet.\n\nConnect your spreadsheet to use it as a command center for bulk content creation. I can:\n\n• Read topics from your sheet\n• Process them automatically\n• Update status as I work\n• Write article URLs back`,
                actions: [{
                    type: 'navigate',
                    label: 'Connect Google Sheets',
                    params: { path: '/dashboard/connections.html' }
                }],
                suggestions: ['How does it work?', 'What columns do I need?', 'Show me an example']
            };
        }

        // Check for specific row processing
        const rowMatch = message.match(/(?:row|#)\s*(\d+)/i);
        if (rowMatch) {
            const rowIndex = parseInt(rowMatch[1]);
            return {
                type: 'spreadsheet_process_row',
                message: `I'll process row ${rowIndex} from your spreadsheet. This will:\n1. Read the topic/keyword\n2. Generate an article\n3. Update the status to DONE\n4. Add the article URL`,
                actions: [{
                    type: 'spreadsheet_process_row',
                    label: `Process Row ${rowIndex}`,
                    params: { rowIndex }
                }],
                suggestions: ['Process all pending', 'Check spreadsheet first', 'Cancel']
            };
        }

        // Check for "process all" or "process pending"
        if (lowerMessage.includes('process all') || lowerMessage.includes('process pending') || 
            lowerMessage.includes('do all') || lowerMessage.includes('run all')) {
            return {
                type: 'spreadsheet_process_all',
                message: `I'll process all pending topics from your spreadsheet. I'll work through each row with status PENDING or empty.`,
                actions: [{
                    type: 'spreadsheet_process_all',
                    label: 'Process All Pending',
                    params: {}
                }],
                suggestions: ['Check first', 'Cancel']
            };
        }

        // Default: check spreadsheet
        return {
            type: 'spreadsheet_check',
            message: `I'll check your spreadsheet for new topics to process.`,
            actions: [{
                type: 'spreadsheet_check',
                label: 'Check Spreadsheet',
                params: {}
            }],
            suggestions: ['Process all pending', 'How does this work?', 'Show me my sheet']
        };
}

    /**
     * Handle publish intent
     */
    handlePublishIntent() {
        const drafts = db.prepare(
            'SELECT id, title FROM articles WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 5'
        ).all(this.userId, 'review');

        if (drafts.length === 0) {
            return {
                type: 'no_drafts',
                message: 'You don\'t have any articles ready to publish. Would you like to create one?',
                actions: [{
                    type: 'start_content_workflow',
                    label: 'Create New Article',
                    params: { step: 'research' }
                }]
            };
        }

        return {
            type: 'select_draft',
            message: `I found ${drafts.length} article(s) ready to publish. Which one would you like to publish?`,
            actions: drafts.map(d => ({
                type: 'publish_article',
                label: d.title || `Article #${d.id}`,
                params: { articleId: d.id }
            }))
        };
    }

    /**
     * Handle status/credits intent
     */
    handleStatusIntent() {
        const { user, readiness } = this.context;
        
        return {
            type: 'status',
            message: `**Your Account Status:**\n\nPlan: ${user.tier.toUpperCase()}\nCredits: ${user.creditsAvailable === 'unlimited' ? 'Unlimited ♾️' : `${user.creditsAvailable} remaining`}\nArticles created: ${this.context.stats.totalArticles}\n\nReady to publish: ${readiness.ready ? '✅ Yes' : '❌ No'}`,
            actions: user.tier !== 'pro' ? [{
                type: 'navigate',
                label: 'Upgrade Plan',
                params: { path: '/dashboard/billing.html' }
            }] : [],
            suggestions: ['Buy more credits', 'View my articles', 'Create content']
        };
    }

    /**
     * Handle help intent
     */
    handleHelpIntent() {
        return {
            type: 'help',
            message: `**How I Can Help You:**\n\n🎯 **Content Creation**\nSay "I want to rank for [keyword]" and I'll research competitors, create a strategy, and write an SEO-optimized article.\n\n📊 **Spreadsheet Command Center**\nConnect Google Sheets and use it to batch process topics. Add topics with status PENDING, and I'll process them all. Say "Check my spreadsheet" to get started.\n\n📊 **Research**\nI analyze top-ranking content to find gaps and opportunities.\n\n🎨 **Images**\nI can generate featured images that match your content.\n\n🚀 **Publishing**\nConnect WordPress and I'll publish directly to your site with proper formatting.\n\n💾 **Memory**\nI remember your preferences, past articles, and business profile.`,
            suggestions: ['Start creating content', 'Check my spreadsheet', 'Connect WordPress', 'Set up business profile']
        };
    }

    /**
     * Execute action from user
     */
    async executeAction(action, params) {
        const SpreadsheetAgent = require('./spreadsheetAgent');

        switch (action) {
            case 'start_content_workflow':
                if (params.keyword) {
                    return await this.startContentWorkflow(params.keyword, params);
                }
                return {
                    success: true,
                    message: 'What keyword would you like to target?',
                    awaitingInput: 'keyword'
                };

            case 'approve_strategy':
                return await this.generateArticle(params.keyword, params);

            case 'generate_image':
                return await this.generateFeaturedImage(params.keyword, params.title);

            case 'upload_image':
                const imageData = this.workflowState?.data?.image;
                if (imageData) {
                    return await this.uploadImageToGitHub(imageData.buffer, imageData.filename);
                }
                return { success: false, error: 'No image to upload' };

            case 'save_article':
                const contentData = this.workflowState?.data?.generated;
                const imageUrl = this.workflowState?.data?.imageUrl;
                if (contentData) {
                    return await this.saveArticle(contentData, imageUrl);
                }
                return { success: false, error: 'No content to save' };

            case 'publish_article':
                const articleId = params.articleId || this.workflowState?.data?.articleId;
                if (articleId) {
                    return await this.publishToWordPress(articleId);
                }
                return { success: false, error: 'No article to publish' };

            case 'publish_now':
                // Save then publish
                const content = this.workflowState?.data?.generated;
                if (content) {
                    const saveResult = await this.saveArticle(content, null);
                    if (saveResult.success) {
                        return await this.publishToWordPress(saveResult.articleId);
                    }
                    return saveResult;
                }
                return { success: false, error: 'No content to publish' };

            case 'navigate':
                return {
                    success: true,
                    type: 'navigate',
                    data: { path: params.path }
                };

            case 'get_content_ideas':
                return await this.getContentIdeas(params.seedKeyword);

            // Spreadsheet actions
            case 'spreadsheet_check':
                const checkAgent = new SpreadsheetAgent(this.userId);
                return await checkAgent.checkForNewTopics();

            case 'spreadsheet_process_row':
                const rowAgent = new SpreadsheetAgent(this.userId);
                // Get spreadsheet config from connection
                const connection = db.prepare(`
                    SELECT config FROM connections 
                    WHERE user_id = ? AND type = ? AND status = ?
                `).get(this.userId, 'googlesheets', 'active');
                const config = connection?.config ? JSON.parse(connection.config) : {};
                return await rowAgent.processRow(
                    config.spreadsheetId,
                    config.sheetName || 'Sheet1',
                    params.rowIndex
                );

            case 'spreadsheet_process_all':
                const allAgent = new SpreadsheetAgent(this.userId);
                const allConnection = db.prepare(`
                    SELECT config FROM connections 
                    WHERE user_id = ? AND type = ? AND status = ?
                `).get(this.userId, 'googlesheets', 'active');
                const allConfig = allConnection?.config ? JSON.parse(allConnection.config) : {};
                return await allAgent.processAllPending(
                    allConfig.spreadsheetId,
                    allConfig.sheetName || 'Sheet1'
                );

            default:
                return {
                    success: false,
                    error: `Unknown action: ${action}`
                };
        }
    }
}

module.exports = SummonAgent;