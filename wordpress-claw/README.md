# WordPress Claw

AI-powered content generation platform for WordPress. Generate SEO-optimized articles and publish directly to your WordPress site with the help of ClawBot, your AI content assistant.

## 🦞 Features

- **AI Article Generation** - Create SEO-optimized content tailored to your business
- **One-Click Publishing** - Publish directly to WordPress with proper formatting
- **ClawBot AI Assistant** - Your personal content assistant for managing articles
- **WordPress Integration** - Secure connection to your WordPress sites
- **GitHub Image Hosting** - Automatic image hosting for featured images
- **Credit System** - Flexible pricing with pay-per-article or unlimited plans

## 📁 Project Structure

```
wordpress-claw/
├── frontend/               # Static HTML/CSS/JS frontend
│   ├── index.html         # Landing page
│   ├── login.html         # Login page
│   ├── register.html      # Registration page
│   ├── assets/            # Images and static assets
│   └── dashboard/         # Dashboard pages
│       ├── index.html     # Main dashboard
│       ├── articles.html  # Article management
│       ├── clawbot.html   # ClawBot chat interface
│       ├── connections.html # Integration setup
│       └── billing.html   # Subscription management
│
└── backend/               # Node.js/Express API
    ├── server.js          # Main server entry
    ├── package.json       # Dependencies
    ├── .env.example       # Environment variables template
    ├── database/
    │   ├── schema.sql     # Database schema
    │   └── db.js          # Database connection
    ├── middleware/
    │   └── auth.js        # JWT authentication
    ├── routes/
    │   ├── auth.js        # Login/register
    │   ├── user.js        # User profile & dashboard
    │   ├── business-profile.js # Business settings
    │   ├── connections.js # Integration management
    │   ├── articles.js    # Article CRUD & generation
    │   └── clawbot.js     # Chat sessions
    └── services/
        ├── contentGeneration.js # AI content via Laozhang API
        ├── wordpress.js     # WordPress publishing
        └── github.js        # Image hosting
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- SQLite (included)

### Installation

1. Clone the repository:
```bash
git clone <repo-url>
cd wordpress-claw/backend
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your settings
```

4. Start the server:
```bash
npm start
# or for development:
npm run dev
```

The server will start on port 3000 (or PORT from env).

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3000) |
| `JWT_SECRET` | Secret for JWT tokens | Yes |
| `NODE_ENV` | Environment (development/production) | No |
| `DB_PATH` | SQLite database path | No |
| `LAOZHANG_API_KEY` | AI content generation API key | For AI features |
| `LAOZHANG_BASE_URL` | AI API base URL | No |
| `GITHUB_TOKEN` | GitHub personal access token | For image hosting |
| `GITHUB_REPO` | Default image repo | No |
| `GOOGLE_SHEETS_API_KEY` | Google Sheets API key | For Google Sheets integration |

## 💳 Pricing Tiers

| Plan | Price | Credits | Features |
|------|-------|---------|----------|
| Free | $0 | 0 | Basic tools, manual articles |
| Starter | $49/mo | 50/mo | AI generation, GitHub hosting |
| Pro | $169/mo | Unlimited | ClawBot agent, unlimited articles |

Additional credits: $1.61 each

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/verify` - Verify token

### User
- `GET /api/user/profile` - Get profile
- `PATCH /api/user/profile` - Update profile
- `GET /api/user/dashboard` - Get dashboard stats
- `GET /api/user/activity` - Get activity log

### Business Profile
- `GET /api/business-profile` - Get profile
- `PUT /api/business-profile` - Update profile

### Connections
- `GET /api/connections` - List connections
- `POST /api/connections` - Create connection
- `PUT /api/connections/:id` - Update connection
- `POST /api/connections/:id/test` - Test connection
- `DELETE /api/connections/:id` - Delete connection

### Articles
- `GET /api/articles` - List articles
- `POST /api/articles` - Create manual article
- `POST /api/articles/generate` - Generate AI article
- `GET /api/articles/:id` - Get article
- `PUT /api/articles/:id` - Update article
- `POST /api/articles/:id/publish` - Publish to WordPress
- `DELETE /api/articles/:id` - Delete article

### ClawBot
- `GET /api/clawbot/session` - Get/create chat session
- `POST /api/clawbot/message` - Send message
- `POST /api/clawbot/action` - Execute action
- `DELETE /api/clawbot/session/:key` - Clear session

## 🗄️ Database Schema

### Tables
- `users` - User accounts and subscription info
- `business_profiles` - Company and content preferences
- `connections` - WordPress/GitHub integrations
- `articles` - Generated and published content
- `clawbot_sessions` - Persistent chat history
- `payments` - Billing and credit purchases
- `activity_log` - User activity tracking

## 🤖 ClawBot Features

- Persistent chat sessions (survives refresh)
- Full context awareness (business profile, credits, articles)
- Proactive alerts for important issues
- Asks permission before executing actions
- Can generate and publish articles
- Guides users through setup

## 📝 License

Private - All rights reserved.

## 🆘 Support

For support, contact support@wordpressclaw.com or use the in-app ClawBot assistant.