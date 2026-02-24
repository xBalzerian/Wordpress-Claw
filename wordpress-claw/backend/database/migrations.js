function runMigrations(db) {
    console.log('Running database migrations...');
    
    try {
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
        
        console.log('Migrations completed successfully');
    } catch (err) {
        console.error('Migration error:', err.message);
    }
}

module.exports = { runMigrations };