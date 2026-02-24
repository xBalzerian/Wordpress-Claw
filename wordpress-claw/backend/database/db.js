const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'wordpress_claw.db');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize database connection
const db = new Database(DB_PATH);

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

console.log('Database initialized at:', DB_PATH);

// Run migrations
const { runMigrations } = require('./migrations');
runMigrations();

module.exports = db;