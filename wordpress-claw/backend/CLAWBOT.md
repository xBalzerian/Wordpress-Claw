# ClawBot - AI Content Strategist

ClawBot is the intelligent AI assistant powering WordPress Claw. It acts as a persistent content strategist that researches competitors, generates SEO-optimized content, and publishes directly to WordPress.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         ClawBot                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Research   │  │   Content    │  │      Publish         │  │
│  │   Service    │──│  Generation  │──│      Service         │  │
│  │              │  │   (Kimi)     │  │   (WordPress)        │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│         │                 │                    │                │
│         ▼                 ▼                    ▼                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    SummonAgent                           │  │
│  │         (Main Orchestrator & Context Manager)            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              ClawBot Routes (API Layer)                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## API Configuration

### Content Generation (Kimi API)
- **Base URL**: `https://api.kimi.moonshot.cn/v1`
- **Model**: `kimi-k2.5` (or `kimi-coding`/`k2p5`)
- **API Key**: Set via `KIMI_API_KEY` environment variable

### Image Generation (Nano Banana Pro / Gemini)
- **Model**: `gemini-3-pro-image-preview`
- **API Key**: `sk-cPzX75qEIsFhSLiVEeAc075bFbE54b3b8cD716A56aB74646`
- **Base URL**: `https://api.nano-banana.pro/v1`

### Google Search (Research)
- **API**: SerpAPI (optional, falls back to mock data)
- **API Key**: Set via `SERPAPI_KEY` environment variable

## Environment Variables

```bash
# Kimi API (Content Generation)
KIMI_API_KEY=your-kimi-api-key
KIMI_BASE_URL=https://api.kimi.moonshot.cn/v1
KIMI_MODEL=kimi-k2.5

# Nano Banana Pro (Image Generation)
NANO_BANANA_API_KEY=sk-cPzX75qEIsFhSLiVEeAc075bFbE54b3b8cD716A56aB74646
NANO_BANANA_BASE_URL=https://api.nano-banana.pro/v1
NANO_BANANA_MODEL=gemini-3-pro-image-preview

# Google Search (Research)
SERPAPI_KEY=your-serpapi-key

# Core
JWT_SECRET=your-jwt-secret
NODE_ENV=production
```

## API Endpoints

### Chat Session Management

#### Get or Create Session
```http
GET /api/clawbot/session
Authorization: Bearer {token}
```

Returns a chat session with proactive greeting based on user state.

#### Send Message
```http
POST /api/clawbot/message
Authorization: Bearer {token}
Content-Type: application/json

{
  "sessionKey": "uuid",
  "message": "I want to rank for best coffee shop in Manila"
}
```

#### Execute Action
```http
POST /api/clawbot/action
Authorization: Bearer {token}
Content-Type: application/json

{
  "sessionKey": "uuid",
  "action": "approve_strategy",
  "params": { "keyword": "best coffee shop in Manila" }
}
```

### Content Workflow

#### Start Content Research
```http
POST /api/clawbot/workflow/content
Authorization: Bearer {token}
Content-Type: application/json

{
  "sessionKey": "uuid",
  "keyword": "best coffee shop in Manila"
}
```

#### Generate Article
```http
POST /api/clawbot/workflow/generate
Authorization: Bearer {token}
Content-Type: application/json

{
  "sessionKey": "uuid",
  "keyword": "best coffee shop in Manila",
  "options": {
    "customPrompt": "optional custom instructions"
  }
}
```

#### Generate Featured Image
```http
POST /api/clawbot/workflow/image
Authorization: Bearer {token}
Content-Type: application/json

{
  "sessionKey": "uuid",
  "keyword": "best coffee shop in Manila",
  "title": "10 Best Coffee Shops in Manila You Must Visit"
}
```

#### Publish to WordPress
```http
POST /api/clawbot/workflow/publish
Authorization: Bearer {token}
Content-Type: application/json

{
  "sessionKey": "uuid",
  "articleId": 123
}
```

### Content Ideas

#### Get Content Ideas
```http
GET /api/clawbot/ideas?keyword=marketing
Authorization: Bearer {token}
```

## Content Creation Workflow

### Step 1: Research
When user says: *"I want to rank for 'best coffee shop in Manila'"*

1. Search Google for the keyword
2. Analyze top 10 ranking articles
3. Extract insights:
   - Average word count
   - Content structure
   - User intent
   - Content gaps
4. Present strategy to user

### Step 2: Strategy
ClawBot presents findings:
```
📊 Research Complete for "best coffee shop in Manila"

Competitor Analysis:
• Average word count: 2,400 words
• Content difficulty: MEDIUM
• User intent: commercial

Strategy Recommendation:
• Target length: 2,900+ words
• Content type: comparison article
• Key topics: location guides, price comparisons, reviews

Ready to proceed?
[Yes, Create This Article] [Adjust Parameters]
```

### Step 3: Create
1. Generate SEO-optimized article with Kimi API
2. Structure includes:
   - Title with keyword
   - Meta title & description
   - Introduction with hook
   - H2s with LSI keywords
   - FAQ section
   - CTA
3. Generate featured image with Nano Banana Pro
4. Upload image to GitHub

### Step 4: Publish
1. Save article to database
2. Publish to WordPress with:
   - Yoast meta fields
   - Featured image
   - Proper formatting
   - Tags and categories
3. Report live URL to user

## Persistent Memory

ClawBot maintains context across sessions:

### User Context
- Business profile (industry, tone, target audience)
- Connection status (WordPress, GitHub)
- Credit balance and tier
- Past articles and performance
- Conversation history (last 50 messages)

### Workflow State
- Current step in content creation
- Research data
- Generated content
- Pending actions

### Proactive Guidance
Based on user state, ClawBot greets with:

```javascript
IF business_profile.incomplete 
  → "Let's finish your profile first..."
  
IF !wordpress_connected 
  → "Connect WordPress so I can publish for you..."
  
IF !keywords_set 
  → "What keywords do you want to rank for?"
  
IF everything_ready 
  → "Ready to create ranking content! What's the target?"
```

## File Structure

```
backend/
├── services/
│   ├── contentGeneration.js    # Kimi API integration
│   ├── imageGeneration.js      # Nano Banana Pro integration
│   ├── research.js             # Google search & analysis
│   ├── summonAgent.js          # Main AI orchestrator
│   ├── wordpress.js            # WordPress publishing
│   └── github.js               # Image hosting
├── routes/
│   └── clawbot.js              # API endpoints
├── tools/
│   └── webSearch.js            # Search utility
├── database/
│   └── schema.sql              # Database schema
└── .env.example                # Environment variables
```

## Response Format

All responses follow this structure:

```json
{
  "success": true,
  "data": {
    "sessionKey": "uuid",
    "message": "Human-readable response",
    "type": "greeting|research_complete|strategy|create_complete|published",
    "actions": [
      {
        "type": "action_name",
        "label": "Button Label",
        "params": {}
      }
    ],
    "suggestions": ["Quick reply options"],
    "context": { /* user state */ }
  }
}
```

## Error Handling

```json
{
  "success": false,
  "error": "Error description",
  "message": "User-friendly error message",
  "step": "failed_step_name"
}
```

## Testing

Run syntax checks:
```bash
cd backend
node -c services/contentGeneration.js
node -c services/imageGeneration.js
node -c services/research.js
node -c services/summonAgent.js
node -c routes/clawbot.js
```

## Future Enhancements

- [ ] Multi-language support
- [ ] Content calendar scheduling
- [ ] A/B testing for headlines
- [ ] Social media post generation
- [ ] Content performance analytics
- [ ] Competitor monitoring alerts
