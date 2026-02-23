const axios = require('axios');

const KIMI_API_KEY = process.env.KIMI_API_KEY;
const KIMI_BASE_URL = process.env.KIMI_BASE_URL || 'https://api.kimi.moonshot.cn/v1';
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.5';

/**
 * Generate article content using Kimi API
 */
async function generateContent({ keyword, businessProfile, customPrompt, userId, articleId, researchData = null }) {
    if (!KIMI_API_KEY) {
        throw new Error('Kimi API key not configured');
    }

    // Build system prompt based on business profile and research data
    const systemPrompt = buildSystemPrompt(businessProfile, researchData);

    // Build user prompt
    const userPrompt = customPrompt || buildUserPrompt(keyword, businessProfile, researchData);

    try {
        const response = await axios.post(
            `${KIMI_BASE_URL}/chat/completions`,
            {
                model: KIMI_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 8000
            },
            {
                headers: {
                    'Authorization': `Bearer ${KIMI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 180000 // 3 minute timeout for generation
            }
        );

        const content = response.data.choices[0].message.content;
        
        // Parse the generated content
        return parseGeneratedContent(content, keyword);
    } catch (err) {
        console.error('Content generation error:', err.message);
        if (err.response) {
            console.error('Kimi API error:', err.response.data);
        }
        throw new Error(`Failed to generate content: ${err.message}`);
    }
}

/**
 * Build system prompt from business profile and research data
 */
function buildSystemPrompt(profile, researchData = null) {
    const tone = profile?.tone || 'professional';
    const wordCount = profile?.word_count || 1500;
    const contentType = profile?.content_type || 'blog_post';
    const location = profile?.location || '';

    const toneGuidelines = {
        professional: 'Use professional, authoritative language suitable for B2B audiences. Be clear, concise, and data-driven.',
        casual: 'Use conversational, approachable language that feels friendly and accessible. Write like you\'re talking to a friend.',
        friendly: 'Be warm and engaging while maintaining expertise. Use inclusive language and positive framing.',
        formal: 'Use formal academic or business writing style with precise terminology. Maintain objectivity.',
        witty: 'Incorporate clever wordplay and humor while remaining informative. Be memorable and entertaining.'
    };

    let prompt = `You are an expert SEO content strategist and writer specializing in creating high-ranking, engaging ${contentType.replace('_', ' ')}s.

WRITING GUIDELINES:
- Target length: ${wordCount} words (aim for ${Math.round(wordCount * 0.95)}-${Math.round(wordCount * 1.05)} words)
- Tone: ${toneGuidelines[tone]}
- Write for humans first, search engines second
- Use clear, descriptive headings (H2, H3) with keywords
- Include actionable insights and practical advice
- Use bullet points and numbered lists where appropriate
- Include a compelling introduction that hooks the reader
- End with a strong call-to-action (CTA)
- Add an FAQ section with 3-5 common questions

${profile?.company_name ? `Company: ${profile.company_name}` : ''}
${profile?.industry ? `Industry: ${profile.industry}` : ''}
${profile?.target_audience ? `Target Audience: ${profile.target_audience}` : ''}
${profile?.description ? `Company Description: ${profile.description}` : ''}
${location ? `Target Location: ${location} (include local references where relevant)` : ''}

SEO REQUIREMENTS:
- Include the main keyword in the first 100 words
- Use LSI keywords naturally throughout
- Write compelling meta title and description
- Include internal linking suggestions
- Add alt text suggestions for images
- Use schema-friendly formatting`;

    // Add research insights if available
    if (researchData) {
        prompt += `\n\nCOMPETITOR RESEARCH INSIGHTS:
`;
        if (researchData.avgWordCount) {
            prompt += `- Top-ranking articles average ${researchData.avgWordCount} words\n`;
        }
        if (researchData.commonHeadings && researchData.commonHeadings.length > 0) {
            prompt += `- Common topics covered: ${researchData.commonHeadings.slice(0, 5).join(', ')}\n`;
        }
        if (researchData.contentGaps && researchData.contentGaps.length > 0) {
            prompt += `- Content gaps to fill: ${researchData.contentGaps.slice(0, 3).join(', ')}\n`;
        }
        if (researchData.userIntent) {
            prompt += `- User intent: ${researchData.userIntent}\n`;
        }
        prompt += `- Goal: Create BETTER content than competitors - more comprehensive, better structured, more helpful\n`;
    }

    prompt += `\nOUTPUT FORMAT:
Provide your response in this exact format:

TITLE: [Engaging, SEO-optimized title under 60 characters - include main keyword]

META_TITLE: [Title tag under 60 characters - compelling for CTR]

META_DESCRIPTION: [Compelling meta description under 160 characters - include keyword and CTA]

EXCERPT: [2-3 sentence summary of the article - engaging hook]

TAGS: [comma, separated, list, of, relevant, tags, for, wordpress]

FOCUS_KEYWORD: [main target keyword]

SECONDARY_KEYWORDS: [comma, separated, LSI, keywords]

CONTENT:
[Full article content in Markdown format with proper headings]

FAQ:
[Q: Question 1?
A: Detailed answer 1]

[Q: Question 2?
A: Detailed answer 2]

[Continue for 3-5 FAQs]`;

    return prompt;
}

/**
 * Build user prompt for article generation
 */
function buildUserPrompt(keyword, profile, researchData = null) {
    let prompt = `Write a comprehensive, SEO-optimized article targeting the keyword: "${keyword}"`;

    if (profile?.keywords) {
        prompt += `\n\nInclude these related keywords naturally throughout the article: ${profile.keywords}`;
    }

    if (profile?.unique_selling_points) {
        prompt += `\n\nConsider these unique selling points where relevant: ${profile.unique_selling_points}`;
    }

    if (profile?.competitors) {
        prompt += `\n\nBe aware of these competitors (don't mention them directly, but differentiate the content): ${profile.competitors}`;
    }

    if (profile?.location) {
        prompt += `\n\nTarget location/region: ${profile.location}. Include local references, landmarks, and location-specific details where appropriate.`;
    }

    if (researchData) {
        prompt += `\n\nBased on competitor analysis, make sure to:`;
        if (researchData.contentGaps && researchData.contentGaps.length > 0) {
            prompt += `\n- Address these content gaps: ${researchData.contentGaps.slice(0, 3).join(', ')}`;
        }
        prompt += `\n- Be more comprehensive and helpful than existing content`;
        prompt += `\n- Provide unique insights and actionable advice`;
    }

    return prompt;
}

/**
 * Parse generated content into structured format
 */
function parseGeneratedContent(content, keyword) {
    const result = {
        title: '',
        metaTitle: '',
        metaDescription: '',
        excerpt: '',
        tags: '',
        focusKeyword: keyword,
        secondaryKeywords: '',
        content: '',
        faq: ''
    };

    // Extract TITLE
    const titleMatch = content.match(/TITLE:\s*(.+?)(?=\n\n|\nMETA_TITLE:|$)/s);
    if (titleMatch) result.title = titleMatch[1].trim();

    // Extract META_TITLE
    const metaTitleMatch = content.match(/META_TITLE:\s*(.+?)(?=\n\n|\nMETA_DESCRIPTION:|$)/s);
    if (metaTitleMatch) result.metaTitle = metaTitleMatch[1].trim();

    // Extract META_DESCRIPTION
    const metaDescMatch = content.match(/META_DESCRIPTION:\s*(.+?)(?=\n\n|\nEXCERPT:|$)/s);
    if (metaDescMatch) result.metaDescription = metaDescMatch[1].trim();

    // Extract EXCERPT
    const excerptMatch = content.match(/EXCERPT:\s*(.+?)(?=\n\n|\nTAGS:|$)/s);
    if (excerptMatch) result.excerpt = excerptMatch[1].trim();

    // Extract TAGS
    const tagsMatch = content.match(/TAGS:\s*(.+?)(?=\n\n|\nFOCUS_KEYWORD:|$)/s);
    if (tagsMatch) result.tags = tagsMatch[1].trim();

    // Extract FOCUS_KEYWORD
    const focusKeywordMatch = content.match(/FOCUS_KEYWORD:\s*(.+?)(?=\n\n|\nSECONDARY_KEYWORDS:|$)/s);
    if (focusKeywordMatch) result.focusKeyword = focusKeywordMatch[1].trim();

    // Extract SECONDARY_KEYWORDS
    const secondaryKeywordsMatch = content.match(/SECONDARY_KEYWORDS:\s*(.+?)(?=\n\n|\nCONTENT:|$)/s);
    if (secondaryKeywordsMatch) result.secondaryKeywords = secondaryKeywordsMatch[1].trim();

    // Extract CONTENT (everything between CONTENT: and FAQ: or end)
    const contentMatch = content.match(/CONTENT:\s*([\s\S]+?)(?=\n\nFAQ:|\nFAQ:|$)/s);
    if (contentMatch) {
        result.content = contentMatch[1].trim();
    } else {
        // If no FAQ section, get everything after CONTENT:
        const contentOnlyMatch = content.match(/CONTENT:\s*([\s\S]+)$/);
        if (contentOnlyMatch) {
            result.content = contentOnlyMatch[1].trim();
        }
    }

    // Extract FAQ
    const faqMatch = content.match(/FAQ:\s*([\s\S]+)$/);
    if (faqMatch) {
        result.faq = faqMatch[1].trim();
        // Append FAQ to content if found
        if (result.faq) {
            result.content += '\n\n## Frequently Asked Questions\n\n' + result.faq;
        }
    }

    // Fallbacks
    if (!result.title) result.title = `Complete Guide to ${keyword}`;
    if (!result.metaTitle) result.metaTitle = result.title;
    if (!result.excerpt) result.excerpt = result.content.substring(0, 200).replace(/[#*_]/g, '') + '...';
    if (!result.focusKeyword) result.focusKeyword = keyword;

    return result;
}

/**
 * Generate image prompt for article featured image
 */
async function generateImagePrompt(articleTitle, keyword, businessProfile = null) {
    const systemPrompt = `You are an expert at creating detailed image generation prompts for AI image generators like Gemini, DALL-E, Midjourney, or Stable Diffusion. Create prompts that result in professional, eye-catching featured images for blog articles.`;

    let userPrompt = `Create a detailed image generation prompt for a featured image to accompany an article titled: "${articleTitle}"

The image should be:
- Professional and modern
- Relevant to the topic: ${keyword}
- Suitable for a business blog
- Clean composition with space for text overlay if needed
- High quality, photorealistic or professional illustration style

Provide only the image prompt, no explanation.`;

    if (businessProfile?.industry) {
        userPrompt += `\n\nIndustry context: ${businessProfile.industry}`;
    }

    try {
        const response = await axios.post(
            `${KIMI_BASE_URL}/chat/completions`,
            {
                model: KIMI_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 500
            },
            {
                headers: {
                    'Authorization': `Bearer ${KIMI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        return response.data.choices[0].message.content.trim();
    } catch (err) {
        console.error('Image prompt generation error:', err.message);
        return `Professional business photography about ${keyword}, modern clean design, high quality, suitable for blog featured image, bright lighting, professional composition`;
    }
}

/**
 * Generate content improvement suggestions
 */
async function generateImprovementSuggestions(content, keyword) {
    if (!KIMI_API_KEY) {
        throw new Error('Kimi API key not configured');
    }

    const systemPrompt = `You are an expert SEO editor. Analyze content and provide specific, actionable improvement suggestions.`;

    const userPrompt = `Analyze this article targeting "${keyword}" and provide 3-5 specific improvement suggestions:

${content.substring(0, 3000)}...

Provide suggestions in this format:
1. [Area]: [Specific suggestion]
2. [Area]: [Specific suggestion]
etc.`;

    try {
        const response = await axios.post(
            `${KIMI_BASE_URL}/chat/completions`,
            {
                model: KIMI_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.7,
                max_tokens: 1000
            },
            {
                headers: {
                    'Authorization': `Bearer ${KIMI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        return response.data.choices[0].message.content.trim();
    } catch (err) {
        console.error('Improvement suggestions error:', err.message);
        return null;
    }
}

module.exports = {
    generateContent,
    generateImagePrompt,
    generateImprovementSuggestions
};