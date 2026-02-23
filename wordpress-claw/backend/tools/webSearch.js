const axios = require('axios');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const DAILY_LIMIT = parseInt(process.env.SERPAPI_DAILY_LIMIT) || 250;

// Simple in-memory usage tracking (resets on server restart)
// For production, use Redis or database
let dailyUsage = {
    count: 0,
    date: new Date().toDateString()
};

/**
 * Perform web search using SerpAPI
 * Only used for article research - NOT for casual chat
 * Limited to 250 searches/day
 */
async function web_search({ query, count = 10 }) {
    // Check if we have API key
    if (!SERPAPI_KEY) {
        console.log('⚠️  SERPAPI_KEY not configured, using mock data');
        return getMockSearchResults(query);
    }

    // Check daily limit
    const limitStatus = checkDailyLimit();
    if (!limitStatus.canSearch) {
        console.log(`⚠️  SerpAPI daily limit reached (${DAILY_LIMIT}/${DAILY_LIMIT}). Using mock data.`);
        return getMockSearchResults(query);
    }

    try {
        const results = await searchWithSerpAPI(query, count);
        incrementUsage();
        console.log(`✅ SerpAPI search #${dailyUsage.count}/${DAILY_LIMIT} used for: "${query.substring(0, 50)}..."`);
        return results;
    } catch (err) {
        console.error('❌ SerpAPI search failed:', err.message);
        console.log('⚠️  Falling back to mock data');
        return getMockSearchResults(query);
    }
}

/**
 * Check if we can perform a search today
 */
function checkDailyLimit() {
    const today = new Date().toDateString();
    
    // Reset counter if it's a new day
    if (dailyUsage.date !== today) {
        dailyUsage = {
            count: 0,
            date: today
        };
    }

    return {
        canSearch: dailyUsage.count < DAILY_LIMIT,
        remaining: DAILY_LIMIT - dailyUsage.count,
        used: dailyUsage.count,
        limit: DAILY_LIMIT
    };
}

/**
 * Increment usage counter
 */
function incrementUsage() {
    dailyUsage.count++;
}

/**
 * Get current usage status
 */
function getUsageStatus() {
    return checkDailyLimit();
}

/**
 * Search using SerpAPI (Google Search API)
 */
async function searchWithSerpAPI(query, count = 10) {
    const response = await axios.get('https://serpapi.com/search', {
        params: {
            q: query,
            api_key: SERPAPI_KEY,
            engine: 'google',
            num: Math.min(count, 10), // Max 10 results
            gl: 'us',
            hl: 'en'
        },
        timeout: 30000
    });

    const organicResults = response.data.organic_results || [];
    
    return organicResults.map((result, index) => ({
        position: index + 1,
        title: result.title,
        url: result.link,
        snippet: result.snippet || result.description || '',
        domain: extractDomain(result.link)
    }));
}

/**
 * Extract domain from URL
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch {
        return '';
    }
}

/**
 * Get mock search results for development/testing
 * Used when API limit reached or not configured
 */
function getMockSearchResults(query) {
    const safeQuery = query.replace(/[^a-zA-Z0-9\s]/g, ' ');
    
    return [
        {
            position: 1,
            title: `Complete Guide to ${safeQuery} - Best Practices & Tips 2024`,
            url: `https://example.com/guide-to-${safeQuery.replace(/\s+/g, '-')}`,
            snippet: `Learn everything about ${safeQuery}. This comprehensive guide covers best practices, tips, and strategies for success. Expert advice and proven techniques.`,
            domain: 'example.com'
        },
        {
            position: 2,
            title: `Top 10 ${safeQuery} Strategies for 2024`,
            url: `https://blog.example.com/top-${safeQuery.replace(/\s+/g, '-')}-strategies`,
            snippet: `Discover the top strategies for ${safeQuery}. Expert advice and proven techniques to help you succeed. Updated for 2024 with latest trends.`,
            domain: 'blog.example.com'
        },
        {
            position: 3,
            title: `What is ${safeQuery}? A Beginner's Guide`,
            url: `https://guide.example.com/what-is-${safeQuery.replace(/\s+/g, '-')}`,
            snippet: `New to ${safeQuery}? This beginner's guide explains everything you need to know to get started. Step-by-step instructions and examples included.`,
            domain: 'guide.example.com'
        },
        {
            position: 4,
            title: `${safeQuery} vs Alternatives: Which is Best?`,
            url: `https://compare.example.com/${safeQuery.replace(/\s+/g, '-')}-comparison`,
            snippet: `Compare ${safeQuery} with alternatives. Find out which option is best for your needs. Detailed comparison with pros and cons.`,
            domain: 'compare.example.com'
        },
        {
            position: 5,
            title: `How to Master ${safeQuery} in 30 Days`,
            url: `https://mastery.example.com/learn-${safeQuery.replace(/\s+/g, '-')}`,
            snippet: `Master ${safeQuery} with our 30-day program. Step-by-step lessons and practical exercises. Join thousands of successful students.`,
            domain: 'mastery.example.com'
        },
        {
            position: 6,
            title: `The Ultimate ${safeQuery} Resource [2024]`,
            url: `https://resources.example.com/${safeQuery.replace(/\s+/g, '-')}`,
            snippet: `The most comprehensive resource for ${safeQuery}. Tools, templates, and guides to help you succeed. Free downloads included.`,
            domain: 'resources.example.com'
        },
        {
            position: 7,
            title: `${safeQuery} Case Studies: Real Results`,
            url: `https://cases.example.com/${safeQuery.replace(/\s+/g, '-')}-case-studies`,
            snippet: `See real case studies of ${safeQuery} in action. Learn from successful implementations and avoid common mistakes.`,
            domain: 'cases.example.com'
        },
        {
            position: 8,
            title: `Expert Tips for ${safeQuery} Success`,
            url: `https://experts.example.com/${safeQuery.replace(/\s+/g, '-')}-tips`,
            snippet: `Industry experts share their top tips for ${safeQuery} success. Insider knowledge and advanced strategies revealed.`,
            domain: 'experts.example.com'
        },
        {
            position: 9,
            title: `${safeQuery} Tools: The Complete List`,
            url: `https://tools.example.com/${safeQuery.replace(/\s+/g, '-')}-tools`,
            snippet: `Discover the best tools for ${safeQuery}. Comprehensive reviews and comparisons to help you choose the right solution.`,
            domain: 'tools.example.com'
        },
        {
            position: 10,
            title: `Common ${safeQuery} Mistakes to Avoid`,
            url: `https://mistakes.example.com/${safeQuery.replace(/\s+/g, '-')}-mistakes`,
            snippet: `Don't make these common ${safeQuery} mistakes. Learn what to avoid and how to fix issues if they occur.`,
            domain: 'mistakes.example.com'
        }
    ];
}

module.exports = {
    web_search,
    getUsageStatus,
    checkDailyLimit
};