# Google Sheets Test Guide for Render

## Your Service Account Email

To find your service account email, decode your key:

```bash
echo $GOOGLE_SERVICE_ACCOUNT_KEY | base64 -d | grep client_email
```

It will look like:
`wordpress-claw-service@wordpress-claw-123456.iam.gserviceaccount.com`

## Test Spreadsheet Template

Create a Google Sheet with this structure:

### Sheet Name: `Topics`

| Status | Main Keyword | Priority | Notes | WP Post URL |
|--------|--------------|----------|-------|-------------|
| PENDING | Best coffee in Manila | High | Focus on specialty | |
| PENDING | SEO tips for beginners | Medium | | |
| PENDING | Digital marketing 2024 | High | Include AI section | |

## API Endpoints to Test

### 1. Get Setup Info
```bash
curl https://your-app.onrender.com/api/sheets/setup-info \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 2. Connect Spreadsheet
```bash
curl -X POST https://your-app.onrender.com/api/sheets/connect \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/YOUR_ID/edit",
    "sheetName": "Topics"
  }'
```

### 3. Check for Topics
```bash
curl -X POST https://your-app.onrender.com/api/sheets/clawbot/check \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Process All Pending
```bash
curl -X POST https://your-app.onrender.com/api/sheets/clawbot/process-all \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Expected Flow

1. User shares sheet with service account email
2. User connects sheet via API
3. ClawBot reads PENDING rows
4. ClawBot processes each row:
   - Updates status to PROCESSING
   - Generates article
   - Updates status to DONE
   - Adds WP Post URL
