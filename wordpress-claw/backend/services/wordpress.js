const axios = require('axios');

/**
 * Publish article to WordPress via REST API
 */
async function publishToWordPress({ article, credentials }) {
    const { url, username, password } = credentials;

    if (!url || !username || !password) {
        throw new Error('Missing WordPress credentials');
    }

    // Clean up URL
    const baseUrl = url.replace(/\/+$/, '');
    const apiUrl = `${baseUrl}/wp-json/wp/v2/posts`;

    // Prepare post data
    const postData = {
        title: article.title,
        content: article.content,
        excerpt: article.excerpt || '',
        status: 'publish',
        format: 'standard'
    };

    // Add tags if provided
    if (article.tags) {
        const tagNames = article.tags.split(',').map(t => t.trim()).filter(t => t);
        if (tagNames.length > 0) {
            // Create/get tags and get their IDs
            const tagIds = await Promise.all(
                tagNames.map(name => getOrCreateTag(baseUrl, username, password, name))
            );
            postData.tags = tagIds.filter(id => id);
        }
    }

    // Add category if provided
    if (article.category) {
        const categoryId = await getOrCreateCategory(baseUrl, username, password, article.category);
        if (categoryId) {
            postData.categories = [categoryId];
        }
    }

    // Add featured image if URL provided
    if (article.featured_image_url) {
        try {
            const mediaId = await uploadFeaturedImage(baseUrl, username, password, article.featured_image_url);
            if (mediaId) {
                postData.featured_media = mediaId;
            }
        } catch (err) {
            console.error('Featured image upload failed:', err.message);
            // Continue without featured image
        }
    }

    try {
        const response = await axios.post(apiUrl, postData, {
            auth: { username, password },
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000
        });

        return {
            success: true,
            postId: response.data.id,
            url: response.data.link,
            title: response.data.title.rendered
        };
    } catch (err) {
        console.error('WordPress publish error:', err.response?.data || err.message);
        throw new Error(`Failed to publish to WordPress: ${err.response?.data?.message || err.message}`);
    }
}

/**
 * Get or create a tag
 */
async function getOrCreateTag(baseUrl, username, password, tagName) {
    try {
        // First try to find existing tag
        const searchResponse = await axios.get(`${baseUrl}/wp-json/wp/v2/tags`, {
            params: { search: tagName, per_page: 1 },
            auth: { username, password },
            timeout: 10000
        });

        if (searchResponse.data.length > 0) {
            return searchResponse.data[0].id;
        }

        // Create new tag
        const createResponse = await axios.post(
            `${baseUrl}/wp-json/wp/v2/tags`,
            { name: tagName },
            { auth: { username, password }, timeout: 10000 }
        );

        return createResponse.data.id;
    } catch (err) {
        console.error(`Tag error for "${tagName}":`, err.message);
        return null;
    }
}

/**
 * Get or create a category
 */
async function getOrCreateCategory(baseUrl, username, password, categoryName) {
    try {
        // First try to find existing category
        const searchResponse = await axios.get(`${baseUrl}/wp-json/wp/v2/categories`, {
            params: { search: categoryName, per_page: 1 },
            auth: { username, password },
            timeout: 10000
        });

        if (searchResponse.data.length > 0) {
            return searchResponse.data[0].id;
        }

        // Create new category
        const createResponse = await axios.post(
            `${baseUrl}/wp-json/wp/v2/categories`,
            { name: categoryName },
            { auth: { username, password }, timeout: 10000 }
        );

        return createResponse.data.id;
    } catch (err) {
        console.error(`Category error for "${categoryName}":`, err.message);
        return null;
    }
}

/**
 * Upload featured image from URL
 */
async function uploadFeaturedImage(baseUrl, username, password, imageUrl) {
    try {
        // Download image
        const imageResponse = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 30000
        });

        // Upload to WordPress
        const formData = new FormData();
        const blob = new Blob([imageResponse.data], { type: imageResponse.headers['content-type'] || 'image/jpeg' });
        formData.append('file', blob, 'featured-image.jpg');

        const uploadResponse = await axios.post(
            `${baseUrl}/wp-json/wp/v2/media`,
            formData,
            {
                auth: { username, password },
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 60000
            }
        );

        return uploadResponse.data.id;
    } catch (err) {
        console.error('Image upload error:', err.message);
        return null;
    }
}

/**
 * Test WordPress connection
 */
async function testConnection(credentials) {
    const { url, username, password } = credentials;
    const baseUrl = url.replace(/\/+$/, '');

    try {
        const response = await axios.get(`${baseUrl}/wp-json/wp/v2/users`, {
            auth: { username, password },
            timeout: 10000
        });

        return { success: true };
    } catch (err) {
        return { 
            success: false, 
            error: err.response?.data?.message || err.message 
        };
    }
}

module.exports = {
    publishToWordPress,
    testConnection
};