const axios = require('axios');
const { web_search } = require('../tools/webSearch');

const SERPAPI_KEY = process.env.SERPAPI_KEY;

/**
 * Research competitor content for a given keyword
 * Analyzes top 10 Google results and extracts insights
 */
async function researchKeyword(keyword, location = 'us', language = 'en') {
    console.log(`🔍 Researching keyword: "${keyword}"`);
    
    try {
        // Perform web search
        const searchResults = await performSearch(keyword, location, language);
        
        if (!searchResults || searchResults.length === 0) {
            return {
                success: false,
                error: 'No search results found',
                data: null
            };
        }

        // Analyze top results
        const analysis = await analyzeResults(searchResults, keyword);
        
        // Extract insights
        const insights = extractInsights(analysis, keyword);

        return {
            success: true,
            data: {
                keyword,
                searchResults: searchResults.slice(0, 10),
                analysis,
                insights,
                recommendations: generateRecommendations(insights, keyword)
            }
        };
    } catch (err) {
        console.error('Research error:', err.message);
        return {
            success: false,
            error: err.message,
            data: null
        };
    }
}

/**
 * Perform web search using available search capability
 */
async function performSearch(keyword, location = 'us', language = 'en') {
    try {
        // Use web_search tool if available
        const searchResults = await web_search({
            query: keyword,
            count: 10
        });

        return searchResults.map((result, index) => ({
            position: index + 1,
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            domain: extractDomain(result.url)
        }));
    } catch (err) {
        console.error('Search error:', err.message);
        // Return mock data for development/testing
        return getMockSearchResults(keyword);
    }
}

/**
 * Analyze search results to extract content patterns
 */
async function analyzeResults(results, keyword) {
    const analysis = {
        totalResults: results.length,
        avgWordCount: 0,
        wordCounts: [],
        commonHeadings: [],
        contentTypes: [],
        domains: [],
        contentGaps: [],
        userIntent: '',
        difficulty: 'medium'
    };

    // Extract domains
    analysis.domains = [...new Set(results.map(r => r.domain))];

    // Analyze snippets for patterns
    const allSnippets = results.map(r => r.snippet).join(' ');
    
    // Determine user intent
    analysis.userIntent = determineUserIntent(allSnippets, keyword);

    // Determine content difficulty
    analysis.difficulty = determineDifficulty(results, keyword);

    // Extract common heading patterns from titles
    analysis.commonHeadings = extractHeadingPatterns(results.map(r => r.title));

    // Estimate word counts based on content type
    analysis.wordCounts = results.map(r => estimateWordCount(r));
    analysis.avgWordCount = Math.round(
        analysis.wordCounts.reduce((a, b) => a + b, 0) / analysis.wordCounts.length
    );

    // Identify content gaps
    analysis.contentGaps = identifyContentGaps(results, keyword);

    return analysis;
}

/**
 * Extract insights from analysis
 */
function extractInsights(analysis, keyword) {
    return {
        targetWordCount: calculateTargetWordCount(analysis.avgWordCount),
        contentStructure: suggestContentStructure(analysis.commonHeadings),
        keyTopics: analysis.commonHeadings.slice(0, 5),
        missingTopics: analysis.contentGaps,
        userIntent: analysis.userIntent,
        difficulty: analysis.difficulty,
        competitorCount: analysis.domains.length,
        contentType: suggestContentType(analysis.userIntent)
    };
}

/**
 * Generate content recommendations based on research
 */
function generateRecommendations(insights, keyword) {
    const recommendations = [];

    // Word count recommendation
    if (insights.targetWordCount > 2000) {
        recommendations.push(`Create a comprehensive guide of ${insights.targetWordCount}+ words to compete with top-ranking content.`);
    } else {
        recommendations.push(`Aim for ${insights.targetWordCount} words to match competitor depth.`);
    }

    // Content structure
    recommendations.push(`Structure your content with these key sections: ${insights.contentStructure.join(', ')}`);

    // Content gaps
    if (insights.missingTopics.length > 0) {
        recommendations.push(`Fill content gaps by covering: ${insights.missingTopics.slice(0, 3).join(', ')}`);
    }

    // User intent
    recommendations.push(`Focus on ${insights.userIntent} content to match search intent.`);

    // Content type
    recommendations.push(`Format as a ${insights.contentType} for best results.`);

    return recommendations;
}

/**
 * Determine user intent from search results
 */
function determineUserIntent(snippets, keyword) {
    const lowerSnippets = snippets.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();

    // Informational indicators
    const informationalIndicators = [
        'how to', 'what is', 'guide', 'tutorial', 'learn', 'understand',
        'explained', 'meaning', 'definition', 'tips', 'best practices'
    ];

    // Commercial indicators
    const commercialIndicators = [
        'best', 'top', 'review', 'comparison', 'vs', 'versus',
        'buy', 'price', 'cost', 'affordable', 'cheap', 'premium'
    ];

    // Transactional indicators
    const transactionalIndicators = [
        'buy', 'purchase', 'order', 'shop', 'deal', 'discount',
        'sale', 'free shipping', 'add to cart'
    ];

    // Local indicators
    const localIndicators = [
        'near me', 'in ', 'local', 'nearby', 'location', 'address',
        'phone', 'hours', 'directions'
    ];

    let scores = {
        informational: 0,
        commercial: 0,
        transactional: 0,
        local: 0
    };

    informationalIndicators.forEach(indicator => {
        if (lowerSnippets.includes(indicator)) scores.informational++;
    });

    commercialIndicators.forEach(indicator => {
        if (lowerSnippets.includes(indicator)) scores.commercial++;
    });

    transactionalIndicators.forEach(indicator => {
        if (lowerSnippets.includes(indicator)) scores.transactional++;
    });

    localIndicators.forEach(indicator => {
        if (lowerSnippets.includes(indicator)) scores.local++;
    });

    const maxScore = Math.max(...Object.values(scores));
    const intent = Object.keys(scores).find(key => scores[key] === maxScore);

    return intent || 'informational';
}

/**
 * Determine content difficulty
 */
function determineDifficulty(results, keyword) {
    const highAuthorityDomains = [
        'wikipedia.org', 'amazon.com', 'google.com', 'youtube.com',
        'facebook.com', 'linkedin.com', 'twitter.com', 'apple.com',
        'microsoft.com', 'forbes.com', 'nytimes.com', 'bbc.com',
        'cnn.com', 'medium.com', 'hubspot.com', 'shopify.com'
    ];

    let authorityCount = 0;
    results.forEach(result => {
        if (highAuthorityDomains.some(domain => result.domain?.includes(domain))) {
            authorityCount++;
        }
    });

    if (authorityCount >= 5) return 'hard';
    if (authorityCount >= 2) return 'medium';
    return 'easy';
}

/**
 * Extract common heading patterns from titles
 */
function extractHeadingPatterns(titles) {
    const patterns = [];
    const commonPatterns = [
        /how to\s+(.+)/i,
        /best\s+(.+)/i,
        /top\s+\d+\s+(.+)/i,
        /complete\s+guide\s+to\s+(.+)/i,
        /what\s+is\s+(.+)/i,
        /why\s+(.+)/i,
        /the\s+ultimate\s+(.+)/i,
        /(\d+)\s+ways?\s+to\s+(.+)/i
    ];

    titles.forEach(title => {
        commonPatterns.forEach(pattern => {
            const match = title.match(pattern);
            if (match) {
                const patternName = match[0].replace(/:.*/g, '').trim();
                if (!patterns.includes(patternName)) {
                    patterns.push(patternName);
                }
            }
        });
    });

    // Add default patterns if none found
    if (patterns.length === 0) {
        patterns.push('Introduction', 'Key Benefits', 'How It Works', 'Best Practices', 'Conclusion');
    }

    return patterns.slice(0, 8);
}

/**
 * Estimate word count based on result type
 */
function estimateWordCount(result) {
    // This is a rough estimation based on domain and snippet
    const domain = result.domain || '';
    const snippet = result.snippet || '';

    // High-content sites typically have longer articles
    const longFormSites = ['medium.com', 'hubspot.com', 'shopify.com', 'wordpress.com', 'blog'];
    const isLongForm = longFormSites.some(site => domain.includes(site));

    if (isLongForm) {
        return Math.floor(Math.random() * 1000) + 1500; // 1500-2500 words
    }

    // Estimate based on snippet length
    const snippetLength = snippet.length;
    if (snippetLength > 200) {
        return Math.floor(Math.random() * 800) + 1200; // 1200-2000 words
    }

    return Math.floor(Math.random() * 500) + 800; // 800-1300 words
}

/**
 * Calculate target word count based on competitors
 */
function calculateTargetWordCount(avgWordCount) {
    // Target 20% more than average to be more comprehensive
    const target = Math.round(avgWordCount * 1.2);
    // Round to nearest 100
    return Math.ceil(target / 100) * 100;
}

/**
 * Identify content gaps in search results
 */
function identifyContentGaps(results, keyword) {
    const gaps = [];
    const allContent = results.map(r => `${r.title} ${r.snippet}`).join(' ').toLowerCase();

    // Common gap topics to check
    const potentialGaps = [
        'pricing', 'cost', 'comparison', 'pros and cons',
        'case studies', 'examples', 'templates', 'checklist',
        'common mistakes', 'expert tips', 'future trends',
        'beginner guide', 'advanced techniques', 'tools',
        'statistics', 'research', 'data'
    ];

    potentialGaps.forEach(gap => {
        if (!allContent.includes(gap)) {
            gaps.push(gap);
        }
    });

    return gaps.slice(0, 5);
}

/**
 * Suggest content structure based on common headings
 */
function suggestContentStructure(commonHeadings) {
    const structure = ['Introduction'];
    
    // Add relevant sections based on patterns found
    if (commonHeadings.some(h => h.toLowerCase().includes('what') || h.toLowerCase().includes('how'))) {
        structure.push('What is [Topic] / How it Works');
    }
    
    if (commonHeadings.some(h => h.toLowerCase().includes('benefit') || h.toLowerCase().includes('why'))) {
        structure.push('Key Benefits');
    }
    
    structure.push('Main Content Sections');
    
    if (commonHeadings.some(h => h.toLowerCase().includes('tip') || h.toLowerCase().includes('best'))) {
        structure.push('Best Practices / Tips');
    }
    
    structure.push('FAQ');
    structure.push('Conclusion with CTA');

    return structure;
}

/**
 * Suggest content type based on user intent
 */
function suggestContentType(userIntent) {
    const types = {
        informational: 'comprehensive guide',
        commercial: 'comparison article',
        transactional: 'product page',
        local: 'local business guide'
    };

    return types[userIntent] || 'blog post';
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
 */
function getMockSearchResults(keyword) {
    return [
        {
            position: 1,
            title: `Complete Guide to ${keyword} - Best Practices & Tips`,
            url: `https://example.com/guide-to-${keyword.replace(/\s+/g, '-')}`,
            snippet: `Learn everything about ${keyword}. This comprehensive guide covers best practices, tips, and strategies for success.`,
            domain: 'example.com'
        },
        {
            position: 2,
            title: `Top 10 ${keyword} Strategies for 2024`,
            url: `https://blog.example.com/top-${keyword.replace(/\s+/g, '-')}-strategies`,
            snippet: `Discover the top strategies for ${keyword}. Expert advice and proven techniques to help you succeed.`,
            domain: 'blog.example.com'
        },
        {
            position: 3,
            title: `What is ${keyword}? A Beginner's Guide`,
            url: `https://guide.example.com/what-is-${keyword.replace(/\s+/g, '-')}`,
            snippet: `New to ${keyword}? This beginner's guide explains everything you need to know to get started.`,
            domain: 'guide.example.com'
        },
        {
            position: 4,
            title: `${keyword} vs Alternatives: Which is Best?`,
            url: `https://compare.example.com/${keyword.replace(/\s+/g, '-')}-comparison`,
            snippet: `Compare ${keyword} with alternatives. Find out which option is best for your needs.`,
            domain: 'compare.example.com'
        },
        {
            position: 5,
            title: `How to Master ${keyword} in 30 Days`,
            url: `https://mastery.example.com/learn-${keyword.replace(/\s+/g, '-')}`,
            snippet: `Master ${keyword} with our 30-day program. Step-by-step lessons and practical exercises.`,
            domain: 'mastery.example.com'
        }
    ];
}

/**
 * Quick keyword difficulty check
 */
async function checkKeywordDifficulty(keyword) {
    const research = await researchKeyword(keyword);
    
    if (!research.success) {
        return { difficulty: 'unknown', error: research.error };
    }

    return {
        keyword,
        difficulty: research.data.analysis.difficulty,
        avgWordCount: research.data.analysis.avgWordCount,
        userIntent: research.data.analysis.userIntent,
        competitorCount: research.data.analysis.domains.length
    };
}

/**
 * Get content ideas based on keyword
 */
async function getContentIdeas(seedKeyword, count = 10) {
    const ideas = [];
    
    // Common content patterns
    const patterns = [
        `How to ${seedKeyword}`,
        `The Ultimate Guide to ${seedKeyword}`,
        `Top 10 ${seedKeyword} Tips`,
        `What is ${seedKeyword}?`,
        `Why ${seedKeyword} Matters`,
        `${seedKeyword} Best Practices`,
        `${seedKeyword} for Beginners`,
        `Advanced ${seedKeyword} Techniques`,
        `Common ${seedKeyword} Mistakes to Avoid`,
        `${seedKeyword} Trends for 2024`,
        `How to Get Started with ${seedKeyword}`,
        `${seedKeyword} Case Studies`,
        `${seedKeyword} Tools and Resources`,
        `The Future of ${seedKeyword}`,
        `${seedKeyword} vs [Alternative]`
    ];

    // Shuffle and return requested count
    const shuffled = patterns.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

module.exports = {
    researchKeyword,
    checkKeywordDifficulty,
    getContentIdeas,
    determineUserIntent
};