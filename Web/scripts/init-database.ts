import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { masterDatabaseSchema } from '../src/lib/init-schema';

dotenv.config({ path: '.env.local' });

async function initializeDatabase() {
  console.log('Starting database initialization...\n');

  const adminConfig = {
    host: process.env.MASTER_DB_HOST || 'localhost',
    port: parseInt(process.env.MASTER_DB_PORT || '5432'),
    database: 'postgres',
    user: process.env.PG_ADMIN_USER || 'postgres',
    password: process.env.PG_ADMIN_PASSWORD || '',
  };

  const masterDbName = process.env.MASTER_DB_NAME || 'MasterDatabase';

  // Connect to postgres database to create master database
  const adminPool = new Pool(adminConfig);

  try {
    // Check if master database exists
    const checkDb = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [masterDbName]
    );

    if (checkDb.rows.length === 0) {
      console.log(`Creating database: ${masterDbName}`);
      await adminPool.query(`CREATE DATABASE "${masterDbName}"`);
      console.log(`Database "${masterDbName}" created successfully\n`);
    } else {
      console.log(`Database "${masterDbName}" already exists\n`);
    }
  } catch (error) {
    console.error('Error checking/creating database:', error);
    process.exit(1);
  } finally {
    await adminPool.end();
  }

  // Connect to master database to create tables
  const masterConfig = {
    host: process.env.MASTER_DB_HOST || 'localhost',
    port: parseInt(process.env.MASTER_DB_PORT || '5432'),
    database: masterDbName,
    user: process.env.MASTER_DB_USER || 'postgres',
    password: process.env.MASTER_DB_PASSWORD || '',
  };

  const masterPool = new Pool(masterConfig);

  try {
    console.log('Creating tables...');
    await masterPool.query(masterDatabaseSchema);
    console.log('Tables created successfully!\n');

    // Verify tables were created
    const tablesResult = await masterPool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('Created tables:');
    tablesResult.rows.forEach((row) => {
      console.log(`  - ${row.table_name}`);
    });

    console.log('\nDatabase initialization completed successfully!');
  } catch (error) {
    console.error('Error creating tables:', error);
    process.exit(1);
  } finally {
    await masterPool.end();
  }
}

initializeDatabase();
