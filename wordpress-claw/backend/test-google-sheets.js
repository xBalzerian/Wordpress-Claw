/**
 * Test Google Sheets Service Account
 * Run: node test-google-sheets.js
 */

const googleSheetsService = require('./services/googleSheetsService');

async function testServiceAccount() {
    console.log('🦞 WordPress Claw - Google Sheets Test');
    console.log('======================================\n');

    // Check if key is set
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    
    if (!keyJson) {
        console.log('❌ GOOGLE_SERVICE_ACCOUNT_KEY not set!');
        console.log('Please add it to your environment variables.\n');
        process.exit(1);
    }

    console.log('✅ GOOGLE_SERVICE_ACCOUNT_KEY is set\n');

    try {
        // Try to decode and get email
        const decodedKey = Buffer.from(keyJson, 'base64').toString('utf8');
        const credentials = JSON.parse(decodedKey);
        
        console.log('✅ Key is valid base64 JSON\n');
        console.log('📧 Service Account Email:');
        console.log('   ' + credentials.client_email + '\n');
        console.log('📁 Project ID:');
        console.log('   ' + credentials.project_id + '\n');

        // Try to initialize
        console.log('🔌 Initializing Google Sheets service...');
        await googleSheetsService.initialize();
        console.log('✅ Service initialized successfully!\n');

        console.log('📝 Next Steps:');
        console.log('1. Create a Google Sheet');
        console.log('2. Share it with: ' + credentials.client_email);
        console.log('3. Set permission to "Editor"');
        console.log('4. Copy the spreadsheet URL');
        console.log('5. Run: node test-spreadsheet.js <spreadsheet-url>\n');

    } catch (err) {
        console.log('❌ Error:', err.message);
        console.log('\nYour key might not be properly base64-encoded.');
        console.log('To fix, run: cat your-key.json | base64 -w 0\n');
        process.exit(1);
    }
}

testServiceAccount();
