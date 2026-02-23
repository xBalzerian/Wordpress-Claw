const axios = require('axios');
const fs = require('fs');
const path = require('path');

const NANO_BANANA_API_KEY = process.env.NANO_BANANA_API_KEY;
const NANO_BANANA_BASE_URL = process.env.NANO_BANANA_BASE_URL || 'https://api.nano-banana.pro/v1';
const NANO_BANANA_MODEL = process.env.NANO_BANANA_MODEL || 'gemini-3-pro-image-preview';

/**
 * Generate featured image using Nano Banana Pro / Gemini API
 */
async function generateFeaturedImage({ prompt, articleTitle, keyword, width = 1200, height = 630 }) {
    if (!NANO_BANANA_API_KEY) {
        throw new Error('Nano Banana API key not configured');
    }

    // Enhance the prompt for better results
    const enhancedPrompt = enhanceImagePrompt(prompt, articleTitle, keyword);

    try {
        const response = await axios.post(
            `${NANO_BANANA_BASE_URL}/images/generations`,
            {
                model: NANO_BANANA_MODEL,
                prompt: enhancedPrompt,
                n: 1,
                size: `${width}x${height}`,
                quality: 'high',
                style: 'vivid'
            },
            {
                headers: {
                    'Authorization': `Bearer ${NANO_BANANA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 120000, // 2 minute timeout
                responseType: 'arraybuffer'
            }
        );

        // Handle different response formats
        let imageBuffer;
        let mimeType = 'image/png';

        if (response.data && Buffer.isBuffer(response.data)) {
            // Direct binary response
            imageBuffer = response.data;
        } else if (response.data?.data && response.data.data[0]?.b64_json) {
            // Base64 encoded response
            imageBuffer = Buffer.from(response.data.data[0].b64_json, 'base64');
            mimeType = response.data.data[0].mime_type || 'image/png';
        } else if (response.data?.data && response.data.data[0]?.url) {
            // URL response - fetch the image
            const imageUrl = response.data.data[0].url;
            const imageResponse = await axios.get(imageUrl, {
                responseType: 'arraybuffer',
                timeout: 30000
            });
            imageBuffer = Buffer.from(imageResponse.data);
            mimeType = imageResponse.headers['content-type'] || 'image/png';
        } else {
            throw new Error('Unexpected response format from image generation API');
        }

        return {
            success: true,
            buffer: imageBuffer,
            mimeType: mimeType,
            filename: `featured-${keyword.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${Date.now()}.png`
        };
    } catch (err) {
        console.error('Image generation error:', err.message);
        if (err.response) {
            console.error('Nano Banana API error:', err.response.data?.toString() || err.response.statusText);
        }
        throw new Error(`Failed to generate image: ${err.message}`);
    }
}

/**
 * Generate image from a simple description
 */
async function generateImageFromDescription({ description, keyword, style = 'professional' }) {
    const prompt = `${description}, ${style} style, high quality, suitable for business blog, clean composition`;
    
    return generateFeaturedImage({
        prompt,
        articleTitle: description,
        keyword: keyword || 'article'
    });
}

/**
 * Enhance image prompt for better results
 */
function enhanceImagePrompt(prompt, articleTitle, keyword) {
    let enhanced = prompt;

    // Add quality modifiers if not present
    const qualityModifiers = [
        'high quality',
        'professional',
        'detailed',
        'sharp focus'
    ];

    const hasQualityModifier = qualityModifiers.some(mod => 
        enhanced.toLowerCase().includes(mod.toLowerCase())
    );

    if (!hasQualityModifier) {
        enhanced += ', high quality, professional photography, detailed, sharp focus';
    }

    // Add composition guidance for blog featured images
    if (!enhanced.toLowerCase().includes('blog') && !enhanced.toLowerCase().includes('website')) {
        enhanced += ', suitable for blog featured image, wide format composition';
    }

    // Add lighting if not specified
    if (!enhanced.toLowerCase().includes('lighting') && !enhanced.toLowerCase().includes('light')) {
        enhanced += ', professional lighting';
    }

    return enhanced;
}

/**
 * Generate multiple image variations
 */
async function generateImageVariations({ prompt, n = 3, width = 1200, height = 630 }) {
    if (!NANO_BANANA_API_KEY) {
        throw new Error('Nano Banana API key not configured');
    }

    try {
        const response = await axios.post(
            `${NANO_BANANA_BASE_URL}/images/generations`,
            {
                model: NANO_BANANA_MODEL,
                prompt: prompt,
                n: n,
                size: `${width}x${height}`,
                quality: 'high'
            },
            {
                headers: {
                    'Authorization': `Bearer ${NANO_BANANA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 180000 // 3 minute timeout for multiple images
            }
        );

        const images = [];
        
        if (response.data?.data) {
            for (let i = 0; i < response.data.data.length; i++) {
                const img = response.data.data[i];
                if (img.b64_json) {
                    images.push({
                        buffer: Buffer.from(img.b64_json, 'base64'),
                        mimeType: img.mime_type || 'image/png',
                        index: i
                    });
                } else if (img.url) {
                    const imageResponse = await axios.get(img.url, {
                        responseType: 'arraybuffer',
                        timeout: 30000
                    });
                    images.push({
                        buffer: Buffer.from(imageResponse.data),
                        mimeType: imageResponse.headers['content-type'] || 'image/png',
                        index: i
                    });
                }
            }
        }

        return {
            success: true,
            images: images
        };
    } catch (err) {
        console.error('Image variations error:', err.message);
        throw new Error(`Failed to generate image variations: ${err.message}`);
    }
}

/**
 * Edit an existing image (if API supports it)
 */
async function editImage({ imageBuffer, prompt, mask }) {
    if (!NANO_BANANA_API_KEY) {
        throw new Error('Nano Banana API key not configured');
    }

    try {
        // This is a placeholder for image editing functionality
        // Implementation depends on the specific API capabilities
        console.log('Image editing not yet implemented for this provider');
        return {
            success: false,
            error: 'Image editing not supported'
        };
    } catch (err) {
        console.error('Image edit error:', err.message);
        throw new Error(`Failed to edit image: ${err.message}`);
    }
}

/**
 * Validate image generation configuration
 */
function validateConfig() {
    const errors = [];
    
    if (!NANO_BANANA_API_KEY) {
        errors.push('NANO_BANANA_API_KEY is not configured');
    }
    
    if (!NANO_BANANA_BASE_URL) {
        errors.push('NANO_BANANA_BASE_URL is not configured');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    generateFeaturedImage,
    generateImageFromDescription,
    generateImageVariations,
    editImage,
    validateConfig,
    enhanceImagePrompt
};