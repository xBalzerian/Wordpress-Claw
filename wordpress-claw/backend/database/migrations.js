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
        
        console.log('PostgreSQL migrations completed successfully');
    } catch (err) {
        console.error('PostgreSQL migration error:', err.message);
    }
}

module.exports = { runMigrations };
