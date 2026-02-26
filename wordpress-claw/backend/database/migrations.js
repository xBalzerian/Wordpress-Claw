function runMigrations(db) {
    console.log('Running database migrations...');
    
    try {
        if (db.isPostgres) {
            // PostgreSQL migrations
            runPostgresMigrations(db);
        } else {
            // SQLite migrations
            runSQLiteMigrations(db);
        }
    } catch (err) {
        console.error('Migration error:', err.message);
    }
}

function runSQLiteMigrations(db) {
    // Check if image_count column exists
    const columns = db.prepare("PRAGMA table_info(business_profiles)").all();
    const hasImageCount = columns.some(col => col.name === 'image_count');
    const hasImageStyle = columns.some(col => col.name === 'image_style');
    const hasAutoPublish = columns.some(col => col.name === 'auto_publish');
    
    if (!hasImageCount) {
        console.log('Adding image_count column...');
        db.exec(`ALTER TABLE business_profiles ADD COLUMN image_count INTEGER DEFAULT 1`);
    }
    
    if (!hasImageStyle) {
        console.log('Adding image_style column...');
        db.exec(`ALTER TABLE business_profiles ADD COLUMN image_style TEXT DEFAULT 'photorealistic'`);
    }
    
    if (!hasAutoPublish) {
        console.log('Adding auto_publish column...');
        db.exec(`ALTER TABLE business_profiles ADD COLUMN auto_publish INTEGER DEFAULT 0`);
    }

    // Check for spreadsheet_rows table
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spreadsheet_rows'").all();
    if (tables.length === 0) {
        console.log('Creating spreadsheet_rows table...');
        db.exec(`
            CREATE TABLE IF NOT EXISTS spreadsheet_rows (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                service_url TEXT,
                main_keyword TEXT,
                cluster_keywords TEXT,
                gdocs_link TEXT,
                wp_post_url TEXT,
                status VARCHAR(50) DEFAULT 'PENDING',
                feature_image TEXT,
                row_order INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_user_id ON spreadsheet_rows(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_status ON spreadsheet_rows(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_row_order ON spreadsheet_rows(row_order)`);
        console.log('spreadsheet_rows table created');
    }

    // Check for content_queue table
    const contentQueueTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_queue'").all();
    if (contentQueueTables.length === 0) {
        console.log('Creating content_queue table...');
        db.exec(`
            CREATE TABLE IF NOT EXISTS content_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                service_url TEXT,
                main_keyword TEXT NOT NULL,
                cluster_keywords TEXT,
                status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error')),
                wp_post_url TEXT,
                feature_image TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_content_queue_user_id ON content_queue(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_content_queue_created ON content_queue(created_at)`);
        console.log('content_queue table created');
    }
    
    console.log('SQLite migrations completed successfully');
}

async function runPostgresMigrations(db) {
    try {
        // Check if columns exist in PostgreSQL
        const checkColumn = async (columnName) => {
            const result = await db.get(
                `SELECT column_name FROM information_schema.columns 
                 WHERE table_name = 'business_profiles' AND column_name = $1`,
                columnName
            );
            return !!result;
        };
        
        const hasImageCount = await checkColumn('image_count');
        const hasImageStyle = await checkColumn('image_style');
        const hasAutoPublish = await checkColumn('auto_publish');
        
        if (!hasImageCount) {
            console.log('Adding image_count column to PostgreSQL...');
            await db.exec(`ALTER TABLE business_profiles ADD COLUMN image_count INTEGER DEFAULT 1`);
        }
        
        if (!hasImageStyle) {
            console.log('Adding image_style column to PostgreSQL...');
            await db.exec(`ALTER TABLE business_profiles ADD COLUMN image_style TEXT DEFAULT 'photorealistic'`);
        }
        
        if (!hasAutoPublish) {
            console.log('Adding auto_publish column to PostgreSQL...');
            await db.exec(`ALTER TABLE business_profiles ADD COLUMN auto_publish BOOLEAN DEFAULT FALSE`);
        }

        // Check for spreadsheet_rows table
        const tableResult = await db.get(
            `SELECT table_name FROM information_schema.tables 
             WHERE table_name = 'spreadsheet_rows'`
        );
        
        if (!tableResult) {
            console.log('Creating spreadsheet_rows table in PostgreSQL...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS spreadsheet_rows (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    service_url TEXT,
                    main_keyword TEXT,
                    cluster_keywords TEXT,
                    gdocs_link TEXT,
                    wp_post_url TEXT,
                    status VARCHAR(50) DEFAULT 'PENDING',
                    feature_image TEXT,
                    row_order INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_user_id ON spreadsheet_rows(user_id)`);
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_status ON spreadsheet_rows(status)`);
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_spreadsheet_rows_row_order ON spreadsheet_rows(row_order)`);
            console.log('spreadsheet_rows table created in PostgreSQL');
        }

        // Check for content_queue table
        const contentQueueResult = await db.get(
            `SELECT table_name FROM information_schema.tables 
             WHERE table_name = 'content_queue'`
        );
        
        if (!contentQueueResult) {
            console.log('Creating content_queue table in PostgreSQL...');
            await db.exec(`
                CREATE TABLE IF NOT EXISTS content_queue (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    service_url TEXT,
                    main_keyword TEXT NOT NULL,
                    cluster_keywords TEXT,
                    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'error')),
                    wp_post_url TEXT,
                    feature_image TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_queue_user_id ON content_queue(user_id)`);
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status)`);
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_queue_created ON content_queue(created_at)`);
            console.log('content_queue table created in PostgreSQL');
        }
        
        console.log('PostgreSQL migrations completed successfully');
    } catch (err) {
        console.error('PostgreSQL migration error:', err.message);
    }
}

module.exports = { runMigrations };
