-- WordPress Claw Database Schema
-- PostgreSQL compatible version

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'starter', 'pro')),
    credits_included INTEGER DEFAULT 0,
    credits_used INTEGER DEFAULT 0,
    subscription_status TEXT DEFAULT 'inactive' CHECK (subscription_status IN ('active', 'inactive', 'cancelled', 'past_due')),
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    preferences TEXT, -- JSON: user preferences like tone, default settings
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Business profiles
CREATE TABLE IF NOT EXISTS business_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    company_name TEXT,
    industry TEXT,
    description TEXT,
    target_audience TEXT,
    location TEXT,
    tone TEXT DEFAULT 'professional' CHECK (tone IN ('professional', 'casual', 'friendly', 'formal', 'witty')),
    word_count INTEGER DEFAULT 1500 CHECK (word_count BETWEEN 300 AND 3000),
    content_type TEXT DEFAULT 'blog_post' CHECK (content_type IN ('blog_post', 'article', 'news', 'tutorial', 'review')),
    keywords TEXT,
    competitors TEXT,
    unique_selling_points TEXT,
    image_count INTEGER DEFAULT 1 CHECK (image_count BETWEEN 1 AND 3),
    image_style TEXT DEFAULT 'photorealistic' CHECK (image_style IN ('photorealistic', 'illustration', '3d', 'photo')),
    auto_publish BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Connections (WordPress, GitHub, Google Sheets)
CREATE TABLE IF NOT EXISTS connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('wordpress', 'github', 'googlesheets')),
    name TEXT,
    credentials TEXT NOT NULL, -- JSON encrypted or plain for now
    config TEXT, -- JSON configuration
    status TEXT DEFAULT 'pending' CHECK (status IN ('active', 'inactive', 'pending', 'error')),
    last_tested_at TIMESTAMP,
    last_error TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Articles
CREATE TABLE IF NOT EXISTS articles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    excerpt TEXT,
    keyword TEXT,
    focus_keyword TEXT,
    secondary_keywords TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'generating', 'review', 'published', 'failed')),
    wp_post_id INTEGER,
    wp_url TEXT,
    featured_image_url TEXT,
    github_image_url TEXT,
    github_image_path TEXT,
    credits_used INTEGER DEFAULT 1,
    meta_title TEXT,
    meta_description TEXT,
    tags TEXT,
    category TEXT,
    research_data TEXT, -- JSON: competitor research data
    generation_params TEXT, -- JSON: parameters used for generation
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    published_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ClawBot chat sessions
CREATE TABLE IF NOT EXISTS clawbot_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_key TEXT NOT NULL UNIQUE,
    messages TEXT NOT NULL, -- JSON array of messages
    context TEXT, -- JSON context data
    workflow_state TEXT, -- JSON: current workflow state
    last_activity_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Payments / Credit purchases
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('subscription', 'credits', 'refund')),
    amount DECIMAL(10,2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    credits_added INTEGER DEFAULT 0,
    stripe_payment_intent_id TEXT,
    stripe_invoice_id TEXT,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Activity log for ClawBot context
CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id INTEGER,
    details TEXT, -- JSON
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Content templates
CREATE TABLE IF NOT EXISTS content_templates (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    template_type TEXT DEFAULT 'article' CHECK (template_type IN ('article', 'section', 'prompt')),
    content TEXT NOT NULL,
    variables TEXT, -- JSON: list of variables
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_articles_user_id ON articles(user_id);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_keyword ON articles(keyword);
CREATE INDEX IF NOT EXISTS idx_connections_user_id ON connections(user_id);
CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(type);
CREATE INDEX IF NOT EXISTS idx_clawbot_sessions_user_id ON clawbot_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_clawbot_sessions_key ON clawbot_sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
