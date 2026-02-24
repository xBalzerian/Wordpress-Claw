# WordPress Claw - PostgreSQL Migration

This migration enables WordPress Claw to use PostgreSQL for persistent data storage on Render, while maintaining SQLite support for local development.

## Changes Made

### 1. Database Layer (`backend/database/`)

- **`pg.js`** - New PostgreSQL connection module using `pg` library
- **`db.js`** - Updated to detect `DATABASE_URL` and switch between PostgreSQL (production) and SQLite (local)
- **`schema_pg.sql`** - PostgreSQL-compatible schema (uses `SERIAL`, `NOW()`, `BOOLEAN`, etc.)
- **`migrations.js`** - Updated to support both SQLite and PostgreSQL migrations

### 2. Route Files (`backend/routes/`)

All routes updated to use `async/await` for database operations:
- `auth.js` - Login/register now async
- `user.js` - Profile operations now async
- `business-profile.js` - Profile CRUD now async
- `connections.js` - Connection management now async
- `articles.js` - Article operations now async
- `clawbot.js` - Chat sessions now async

### 3. Middleware (`backend/middleware/`)

- `auth.js` - Authentication middleware now async

### 4. Services (`backend/services/`)

- `spreadsheetAgent.js` - Database operations now async
- `summonAgent.js` - Database operations now async

### 5. Dependencies (`backend/package.json`)

Added `pg: ^8.11.0` for PostgreSQL support.

## Environment Variables

### Local Development (SQLite)
```bash
# No DATABASE_URL set - uses SQLite automatically
DB_PATH=./database/wordpress_claw.db
JWT_SECRET=your-jwt-secret
```

### Production (Render - PostgreSQL)
```bash
DATABASE_URL=postgres://username:password@host:port/database
JWT_SECRET=your-jwt-secret
NODE_ENV=production
```

## Render Setup Instructions

### 1. Create PostgreSQL Database

1. Go to your Render Dashboard
2. Click "New" → "PostgreSQL"
3. Choose the free tier
4. Give it a name (e.g., "wordpress-claw-db")
5. Wait for it to be created
6. Copy the "Internal Database URL" or "External Database URL"

### 2. Update Web Service Environment Variables

1. Go to your Web Service in Render Dashboard
2. Click "Environment"
3. Add the following variables:
   - `DATABASE_URL` - Paste the PostgreSQL URL from step 1
   - `JWT_SECRET` - Your JWT secret
   - `NODE_ENV` - Set to `production`
   - `FRONTEND_URL` - Your frontend URL (e.g., `https://wordpressclaw.onrender.com`)

### 3. Deploy

1. Push your changes to GitHub
2. Render will automatically deploy
3. Check the logs to confirm PostgreSQL connection:
   ```
   Using PostgreSQL database
   PostgreSQL schema initialized
   ```

## Local Development

```bash
cd backend
npm install
npm run dev
```

The app will automatically use SQLite when `DATABASE_URL` is not set.

## Database Query Differences

| SQLite | PostgreSQL |
|--------|------------|
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| `?` placeholders | `$1, $2, etc.` |
| `CURRENT_TIMESTAMP` | `NOW()` |
| `datetime('now')` | `NOW()` |
| `lastInsertRowid` | `RETURNING id` |
| `BOOLEAN` as INTEGER | `BOOLEAN` native |

## Troubleshooting

### Connection Issues
- Verify `DATABASE_URL` is set correctly in Render dashboard
- Check that the PostgreSQL instance is running
- Ensure the database user has proper permissions

### Migration Issues
- First deployment will auto-create tables via `schema_pg.sql`
- Migrations run automatically on startup
- Check logs for any migration errors

### Data Loss Prevention
- SQLite data is NOT automatically migrated to PostgreSQL
- For production migration, export SQLite data and import to PostgreSQL manually
- Or start fresh with new user accounts

## Rollback

To revert to SQLite:
1. Remove `DATABASE_URL` from environment variables
2. Redeploy
3. App will automatically use SQLite
