const path = require('path');
const fs = require('fs');

// Determine which database to use
const usePostgres = !!process.env.DATABASE_URL;

let db;

if (usePostgres) {
    // Use PostgreSQL (Render/production)
    console.log('Using PostgreSQL database');
    const { pg } = require('./pg');
    
    // Wrap PostgreSQL to match better-sqlite3 sync interface
    db = {
        isPostgres: true,
        
        // Sync-style get (returns Promise, caller must await)
        async get(sql, ...params) {
            return await pg.get(sql, params);
        },
        
        // Sync-style all (returns Promise, caller must await)
        async all(sql, ...params) {
            return await pg.all(sql, params);
        },
        
        // Sync-style run (returns Promise, caller must await)
        async run(sql, ...params) {
            return await pg.runReturning(sql, params);
        },
        
        // For raw execution
        async exec(sql) {
            return await pg.exec(sql);
        },
        
        // For prepared statements compatibility
        prepare(sql) {
            return {
                get: async (...params) => await pg.get(sql, params),
                all: async (...params) => await pg.all(sql, params),
                run: async (...params) => await pg.runReturning(sql, params)
            };
        },
        
        // PRAGMA compatibility (no-ops for PostgreSQL)
        pragma: () => {},
        
        // Close connection
        async close() {
            await pg.close();
        }
    };
    
    // Initialize PostgreSQL schema
    async function initPostgresSchema() {
        const schemaPath = path.join(__dirname, 'schema_pg.sql');
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            try {
                await pg.exec(schema);
                console.log('PostgreSQL schema initialized');
            } catch (err) {
                console.error('Schema execution error:', err.message);
            }
        }
    }
    
    // Initialize schema asynchronously
    initPostgresSchema().then(() => {
        // Run migrations for PostgreSQL
        const { runMigrations } = require('./migrations');
        runMigrations(db);
    });
    
} else {
    // Use SQLite (local development)
    console.log('Using SQLite database');
    const Database = require('better-sqlite3');
    
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'wordpress_claw.db');
    
    // Ensure database directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    // Initialize database connection
    db = new Database(DB_PATH);
    db.isPostgres = false;
    
    // Enable WAL mode for better concurrency
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    
    // Initialize schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Split and execute each statement
    const statements = schema.split(';').filter(s => s.trim());
    for (const statement of statements) {
        try {
            db.exec(statement);
        } catch (err) {
            console.error('Schema execution error:', err.message);
        }
    }
    
    console.log('SQLite database initialized at:', DB_PATH);
    
    // Run migrations
    const { runMigrations } = require('./migrations');
    runMigrations(db);
}

module.exports = db;
