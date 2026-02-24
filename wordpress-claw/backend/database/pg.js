const { Pool } = require('pg');

// PostgreSQL connection using DATABASE_URL from environment
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper to convert SQLite-style queries to PostgreSQL
function convertQuery(sql) {
    // Replace ? with $1, $2, etc.
    let paramIndex = 0;
    const convertedSql = sql.replace(/\?/g, () => `$${++paramIndex}`);
    
    // Replace SQLite datetime functions with PostgreSQL equivalents
    let finalSql = convertedSql
        .replace(/CURRENT_TIMESTAMP/g, 'NOW()')
        .replace(/datetime\('now'\)/gi, 'NOW()');
    
    return finalSql;
}

// Query helper that mimics better-sqlite3 interface
const pg = {
    // For SELECT queries returning a single row
    async get(sql, params = []) {
        const convertedSql = convertQuery(sql);
        const result = await pool.query(convertedSql, params);
        return result.rows[0] || null;
    },
    
    // For SELECT queries returning multiple rows
    async all(sql, params = []) {
        const convertedSql = convertQuery(sql);
        const result = await pool.query(convertedSql, params);
        return result.rows;
    },
    
    // For INSERT/UPDATE/DELETE - returns info about the operation
    async run(sql, params = []) {
        const convertedSql = convertQuery(sql);
        const result = await pool.query(convertedSql, params);
        return {
            changes: result.rowCount,
            lastInsertRowid: result.rows[0]?.id || null
        };
    },
    
    // For raw execution (schema creation, etc.)
    async exec(sql) {
        // Split by semicolon and execute each statement
        const statements = sql.split(';').filter(s => s.trim());
        for (const statement of statements) {
            await pool.query(statement);
        }
    },
    
    // For parameterized execution with RETURNING
    async runReturning(sql, params = []) {
        const convertedSql = convertQuery(sql);
        // Ensure RETURNING clause exists for INSERTs
        let finalSql = convertedSql;
        if (convertedSql.toLowerCase().includes('insert into') && !convertedSql.toLowerCase().includes('returning')) {
            finalSql = `${convertedSql} RETURNING id`;
        }
        const result = await pool.query(finalSql, params);
        return {
            changes: result.rowCount,
            lastInsertRowid: result.rows[0]?.id || null
        };
    },
    
    // Close pool
    async close() {
        await pool.end();
    }
};

// Test connection
pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL error:', err);
});

module.exports = { pool, pg };
