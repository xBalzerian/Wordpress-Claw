# WordPress Claw - Complete Guide

AI-powered content automation SaaS with Google Sheets as the command center.

## 🎯 What This Project Does

WordPress Claw lets users:
1. Add article topics to a Google Sheet
2. AI agent (ClawBot) reads the sheet and generates SEO-optimized articles
3. Auto-publishes to WordPress with featured images
4. Updates the sheet with status and published URLs

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────┐     ┌──────────┐
│  Google     │────▶│ ClawBot  │────▶│ WordPress│
│  Sheets     │     │  Agent   │     │  Publish │
│  (Topics)   │◀────│          │◀────│  (Live)  │
└─────────────┘     └──────────┘     └──────────┘
       ▲                                    │
       └──────── Status Updates ────────────┘
```

## 📁 Project Structure

```
wordpress-claw/
├── backend/
│   ├── server.js              # Express server entry
│   ├── database/
│   │   ├── db.js              # SQLite connection
│   │   ├── schema.sql         # Database schema
│   │   └── migrations.js      # DB migrations
│   ├── routes/
│   │   ├── auth.js            # Login/register
│   │   ├── articles.js        # Article CRUD + generation
│   │   ├── connections.js     # WP/GitHub/Sheets connections
│   │   ├── business-profile.js
│   │   └── clawbot.js         # Agent API endpoints
│   ├── services/
│   │   ├── contentGeneration.js   # Kimi AI integration
│   │   ├── imageGeneration.js     # Laozhang AI for images
│   │   ├── googleSheets.js        # Sheets read/write
│   │   ├── wordpress.js           # WP publishing
│   │   ├── github.js              # Image hosting
│   │   ├── research.js            # SerpAPI research
│   │   └── summonAgent.js         # ClawBot logic
│   └── middleware/
│       └── auth.js            # JWT authentication
│
└── frontend/
    ├── index.html             # Homepage
    ├── docs.html              # Documentation
    ├── login.html
    ├── register.html
    └── dashboard/
        ├── index.html         # Main dashboard
        ├── articles.html
        ├── connections.html   # Connect WP/GitHub/Sheets
        ├── business-profile.html
        ├── clawbot.html       # Chat interface
        ├── spreadsheet.html   # Sheet viewer
        └── billing.html
```

## 🔧 Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js + Express |
| Database | SQLite (better-sqlite3) |
| Frontend | Vanilla HTML/CSS/JS |
| AI Content | Kimi 2.5 API |
| AI Images | Laozhang AI (Gemini) |
| Research | SerpAPI |
| Hosting | Render |
| Repo | GitHub |

## 🚀 Deployment

### Environment Variables (Render)

```env
JWT_SECRET=your_jwt_secret_here
LAOZHANG_API_KEY=your_laozhang_key
LAOZHANG_BASE_URL=https://api.laozhang.ai/v1
LAOZHANG_IMAGE_MODEL=gemini-3-pro-image-preview
SERPAPI_KEY=your_serpapi_key
SERPAPI_DAILY_LIMIT=250
NODE_ENV=production
PORT=10000
```

### Build Commands (Render)

```bash
# Build Command
cd wordpress-claw/backend && npm install

# Start Command
cd wordpress-claw/backend && npm start
```

### GitHub → Render Setup

1. Make repo public (easiest)
2. Connect Render to GitHub
3. Auto-deploy on push enabled

## 💰 Pricing Logic

Per article breakdown:
```
Keyword Research:    $0.01  (SerpAPI)
Content Generation:  $0.60  (Kimi AI)
Image Generation:    $0.80  (Laozhang AI)
WordPress Publish:   $0.20  (API call)
─────────────────────────────────────
Total (1 image):     $1.61
Total (2 images):    $2.41
Total (3 images):    $3.21
```

## 🤖 ClawBot Agent Flow

```
User: "Check my spreadsheet"
  ↓
Agent: Read sheet → Find PENDING rows
  ↓
Agent: "Found 3 topics: Coffee, SEO, Marketing"
  ↓
User: "Process row 1"
  ↓
Agent:
  1. Research keyword (SerpAPI)
  2. Generate article (Kimi)
  3. Generate image (Laozhang)
  4. Upload image to GitHub
  5. Publish to WordPress
  6. Update sheet: PENDING → DONE + URL
  ↓
Agent: "Published! URL: https://..."
```

## 📊 Database Schema

### Users
- id, email, password_hash, tier, credits_used, created_at

### Business Profiles
- user_id, company_name, industry, description, target_audience, location, tone, word_count, content_type, keywords, competitors, unique_selling_points, image_count, image_style, auto_publish

### Articles
- id, user_id, title, content, excerpt, keyword, status, wp_post_id, wp_url, featured_image_url, credits_used, created_at, published_at

### Connections
- id, user_id, type (wordpress/github/googlesheets), credentials (JSON), status, created_at

## 🔌 API Endpoints

### Auth
- `POST /api/auth/register` - Register
- `POST /api/auth/login` - Login

### Articles
- `GET /api/articles` - List articles
- `POST /api/articles` - Create manual article
- `POST /api/articles/generate` - AI generate article
- `PUT /api/articles/:id` - Update article
- `POST /api/articles/:id/publish` - Publish to WordPress

### Connections
- `GET /api/connections` - List connections
- `POST /api/connections` - Create connection
- `POST /api/connections/:id/test` - Test connection

### ClawBot
- `POST /api/clawbot/chat` - Chat with agent
- `POST /api/clawbot/execute` - Execute action
- `GET /api/clawbot/spreadsheet/check` - Check sheet for topics
- `POST /api/clawbot/spreadsheet/process-row` - Process specific row

## 🎨 Frontend Design

- **Primary Color:** #E53935 (Red/Lobster)
- **Font:** Inter
- **Style:** Clean, no gradients, card-based
- **Responsive:** Mobile-friendly

## 🐛 Common Issues & Fixes

### 1. Connect Buttons Not Working
**Cause:** CSP blocking inline scripts
**Fix:** Disable CSP in server.js or add 'unsafe-inline'

### 2. Deploy Not Updating
**Cause:** Render cache
**Fix:** Clear build cache & deploy

### 3. Google Sheets Connection Fails
**Cause:** Sheet not shared properly
**Fix:** Share with "Anyone with link can view"

### 4. Images Not Generating
**Cause:** Laozhang API key missing
**Fix:** Check LAOZHANG_API_KEY env var

## 📝 Creating Another Bot (Template)

To create a similar bot for a different platform:

1. **Copy this repo**
2. **Rename** project in package.json
3. **Change branding** (colors, logo, name)
4. **Modify integrations:**
   - Replace WordPress with your platform
   - Replace Google Sheets with your data source
   - Keep Kimi for content generation
5. **Update pricing** logic if needed
6. **Deploy** to Render

## 🔗 Key Files to Modify

| File | What to Change |
|------|----------------|
| `frontend/index.html` | Homepage content, branding |
| `frontend/dashboard/connections.html` | Integration options |
| `backend/services/wordpress.js` | Replace with your platform API |
| `backend/services/googleSheets.js` | Replace with your data source |
| `backend/server.js` | CSP, CORS settings |

## 📞 Support

- **Render Dashboard:** https://dashboard.render.com
- **GitHub Repo:** https://github.com/xBalzerian/Wordpress-Claw
- **Live Site:** https://wordpress-claw.onrender.com

---

Built with ❤️ by Kimi Claw