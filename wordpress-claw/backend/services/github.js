const axios = require('axios');

/**
 * Upload image to GitHub for hosting
 */
async function uploadImage({ imageBuffer, filename, mimeType, credentials }) {
    const { token, repo, branch = 'main', path = 'images' } = credentials;

    if (!token || !repo) {
        throw new Error('Missing GitHub credentials');
    }

    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '-');
    const filePath = `${path}/${timestamp}-${safeFilename}`;

    // Convert buffer to base64
    const base64Content = Buffer.from(imageBuffer).toString('base64');

    try {
        const response = await axios.put(
            `https://api.github.com/repos/${repo}/contents/${filePath}`,
            {
                message: `Upload image: ${safeFilename}`,
                content: base64Content,
                branch: branch
            },
            {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        return {
            success: true,
            url: response.data.content.download_url,
            htmlUrl: response.data.content.html_url,
            sha: response.data.content.sha,
            path: filePath
        };
    } catch (err) {
        console.error('GitHub upload error:', err.response?.data || err.message);
        throw new Error(`Failed to upload to GitHub: ${err.response?.data?.message || err.message}`);
    }
}

/**
 * Delete image from GitHub
 */
async function deleteImage({ path, sha, credentials }) {
    const { token, repo, branch = 'main' } = credentials;

    if (!token || !repo) {
        throw new Error('Missing GitHub credentials');
    }

    try {
        await axios.delete(
            `https://api.github.com/repos/${repo}/contents/${path}`,
            {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                data: {
                    message: `Delete image: ${path}`,
                    sha: sha,
                    branch: branch
                },
                timeout: 30000
            }
        );

        return { success: true };
    } catch (err) {
        console.error('GitHub delete error:', err.response?.data || err.message);
        throw new Error(`Failed to delete from GitHub: ${err.response?.data?.message || err.message}`);
    }
}

/**
 * List images in repository
 */
async function listImages({ credentials, path = 'images' }) {
    const { token, repo, branch = 'main' } = credentials;

    if (!token || !repo) {
        throw new Error('Missing GitHub credentials');
    }

    try {
        const response = await axios.get(
            `https://api.github.com/repos/${repo}/contents/${path}`,
            {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                params: { ref: branch },
                timeout: 30000
            }
        );

        return {
            success: true,
            images: response.data
                .filter(file => file.type === 'file' && file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i))
                .map(file => ({
                    name: file.name,
                    url: file.download_url,
                    htmlUrl: file.html_url,
                    size: file.size,
                    sha: file.sha,
                    path: file.path,
                    uploadedAt: file.created_at || file.updated_at
                }))
        };
    } catch (err) {
        if (err.response?.status === 404) {
            // Directory doesn't exist yet
            return { success: true, images: [] };
        }
        console.error('GitHub list error:', err.response?.data || err.message);
        throw new Error(`Failed to list images: ${err.response?.data?.message || err.message}`);
    }
}

/**
 * Test GitHub connection
 */
async function testConnection(credentials) {
    const { token, repo } = credentials;

    if (!token) {
        return { success: false, error: 'Missing GitHub token' };
    }

    try {
        // Test token by getting user info
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        });

        // If repo specified, verify access
        if (repo) {
            try {
                await axios.get(`https://api.github.com/repos/${repo}`, {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    timeout: 10000
                });
            } catch (err) {
                return { 
                    success: false, 
                    error: `Cannot access repository "${repo}". Make sure it exists and you have write access.` 
                };
            }
        }

        return { 
            success: true, 
            user: userResponse.data.login 
        };
    } catch (err) {
        return { 
            success: false, 
            error: err.response?.data?.message || 'Invalid GitHub token' 
        };
    }
}

module.exports = {
    uploadImage,
    deleteImage,
    listImages,
    testConnection
};