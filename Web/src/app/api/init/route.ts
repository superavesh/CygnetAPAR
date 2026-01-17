import { NextResponse } from 'next/server';
import { getMasterPool, getAdminPool } from '@/lib/db';
import { initializeMasterDatabase } from '@/lib/init-schema';
import { ApiResponse } from '@/types';

// POST - Initialize the master database
export async function POST() {
  const adminPool = getAdminPool();

  try {
    // Check if master database exists, create if not
    const dbName = process.env.MASTER_DB_NAME || 'MasterDatabase';

    const checkDb = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (checkDb.rows.length === 0) {
      // Create the master database
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Created database: ${dbName}`);
    }

    await adminPool.end();

    // Initialize master database schema
    const masterPool = getMasterPool();
    await initializeMasterDatabase(masterPool);

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Master database initialized successfully',
      data: { database: dbName },
    });
  } catch (error) {
    console.error('Error initializing master database:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: `Failed to initialize database: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

// GET - Check database status
export async function GET() {
  const pool = getMasterPool();

  try {
    // Check if tables exist
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('subscribers', 'tenants', 'scheduled_tasks', 'task_execution_logs')
    `);

    const existingTables = result.rows.map(row => row.table_name);
    const requiredTables = ['subscribers', 'tenants', 'scheduled_tasks', 'task_execution_logs'];
    const missingTables = requiredTables.filter(t => !existingTables.includes(t));

    // Get counts
    let subscriberCount = 0;
    let tenantCount = 0;
    let taskCount = 0;

    if (existingTables.includes('subscribers')) {
      const countResult = await pool.query('SELECT COUNT(*) as count FROM subscribers');
      subscriberCount = parseInt(countResult.rows[0].count);
    }

    if (existingTables.includes('tenants')) {
      const countResult = await pool.query('SELECT COUNT(*) as count FROM tenants');
      tenantCount = parseInt(countResult.rows[0].count);
    }

    if (existingTables.includes('scheduled_tasks')) {
      const countResult = await pool.query('SELECT COUNT(*) as count FROM scheduled_tasks');
      taskCount = parseInt(countResult.rows[0].count);
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        initialized: missingTables.length === 0,
        existingTables,
        missingTables,
        stats: {
          subscribers: subscriberCount,
          tenants: tenantCount,
          scheduledTasks: taskCount,
        },
      },
    });
  } catch (error) {
    console.error('Error checking database status:', error);
    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        initialized: false,
        error: (error as Error).message,
      },
    });
  }
}
