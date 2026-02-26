#!/bin/bash
# Test Google Sheets Integration
# Run this on your local machine or in Render shell

echo "🦞 WordPress Claw - Google Sheets Test"
echo "======================================"
echo ""

# Check if GOOGLE_SERVICE_ACCOUNT_KEY is set
if [ -z "$GOOGLE_SERVICE_ACCOUNT_KEY" ]; then
    echo "❌ GOOGLE_SERVICE_ACCOUNT_KEY not set!"
    echo "Please add it to your environment variables."
    exit 1
fi

echo "✅ GOOGLE_SERVICE_ACCOUNT_KEY is set"
echo ""

# Decode and check the key
echo "🔍 Checking service account key..."
echo $GOOGLE_SERVICE_ACCOUNT_KEY | base64 -d > /tmp/service-account.json 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Key is valid base64"
    echo ""
    echo "📧 Service Account Email:"
    cat /tmp/service-account.json | grep client_email | cut -d'"' -f4
    echo ""
else
    echo "❌ Key is NOT valid base64"
    echo "Please re-encode your JSON file:"
    echo "  cat your-key.json | base64 -w 0"
    exit 1
fi

echo "📝 Next steps:"
echo "1. Create a Google Sheet"
echo "2. Share it with the email above (Editor access)"
echo "3. Copy the spreadsheet URL"
echo "4. Test the API endpoint"
echo ""

# Cleanup
rm -f /tmp/service-account.json
