import { NextRequest, NextResponse } from 'next/server';
import { getMasterPool, getAdminPool, getTenantPool } from '@/lib/db';
import { initializeTenantDatabase } from '@/lib/init-schema';
import { CreateSubscriberRequest, ApiResponse, Subscriber } from '@/types';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// GET - Fetch all subscribers
export async function GET() {
  const pool = getMasterPool();

  try {
    const result = await pool.query(`
      SELECT
        s.id,
        s.subscriber_name,
        s.subscriber_id,
        s.subscriber_url,
        s.subscriber_username,
        s.subscriber_auth_token,
        s.created_at,
        s.updated_at,
        t.is_active as tenant_active,
        t.database_name
      FROM subscribers s
      LEFT JOIN tenants t ON s.subscriber_id = t.subscriber_id
      ORDER BY s.created_at DESC
    `);

    const subscribers = result.rows.map(row => ({
      id: row.id,
      subscriberName: row.subscriber_name,
      subscriberId: row.subscriber_id,
      subscriberURL: row.subscriber_url,
      subscriberUsername: row.subscriber_username,
      subscriberAuthToken: row.subscriber_auth_token,
      tenantActive: row.tenant_active,
      databaseName: row.database_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json<ApiResponse<typeof subscribers>>({
      success: true,
      data: subscribers,
    });
  } catch (error) {
    console.error('Error fetching subscribers:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch subscribers' },
      { status: 500 }
    );
  }
}

// POST - Create a new subscriber with tenant database
export async function POST(request: NextRequest) {
  const masterPool = getMasterPool();
  const adminPool = getAdminPool();

  try {
    const body: CreateSubscriberRequest = await request.json();

    // Validate required fields
    const requiredFields = ['subscriberName', 'subscriberId', 'subscriberURL', 'subscriberUsername', 'subscriberPassword'];
    for (const field of requiredFields) {
      if (!body[field as keyof CreateSubscriberRequest]) {
        return NextResponse.json<ApiResponse>(
          { success: false, error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Check if subscriber already exists
    const existingSubscriber = await masterPool.query(
      'SELECT id FROM subscribers WHERE subscriber_id = $1',
      [body.subscriberId]
    );

    if (existingSubscriber.rows.length > 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber ID already exists' },
        { status: 409 }
      );
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(body.subscriberPassword, 10);

    // Generate auth token if not provided
    const authToken = body.subscriberAuthToken || uuidv4();

    // Start transaction
    const client = await masterPool.connect();

    try {
      await client.query('BEGIN');

      // Insert subscriber
      const subscriberResult = await client.query(
        `INSERT INTO subscribers (subscriber_name, subscriber_id, subscriber_url, subscriber_username, subscriber_password, subscriber_auth_token)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [body.subscriberName, body.subscriberId, body.subscriberURL, body.subscriberUsername, hashedPassword, authToken]
      );

      // Create tenant database name
      const tenantDbName = `Tenant_${body.subscriberId}`;
      const tenantDbUser = `tenant_${body.subscriberId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const tenantDbPassword = uuidv4();

      // Create the tenant database
      const adminClient = await adminPool.connect();
      try {
        // Create database
        await adminClient.query(`CREATE DATABASE "${tenantDbName}"`);

        // Create user for tenant
        await adminClient.query(
          `CREATE USER ${tenantDbUser} WITH PASSWORD '${tenantDbPassword}'`
        );

        // Grant privileges
        await adminClient.query(
          `GRANT ALL PRIVILEGES ON DATABASE "${tenantDbName}" TO ${tenantDbUser}`
        );
      } finally {
        adminClient.release();
      }

      // Insert tenant record
      await client.query(
        `INSERT INTO tenants (subscriber_id, database_name, db_host, db_port, db_user, db_password)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          body.subscriberId,
          tenantDbName,
          process.env.MASTER_DB_HOST || 'localhost',
          parseInt(process.env.MASTER_DB_PORT || '5432'),
          tenantDbUser,
          tenantDbPassword,
        ]
      );

      await client.query('COMMIT');

      // Initialize tenant database schema
      const tenantPool = getTenantPool(
        process.env.MASTER_DB_HOST || 'localhost',
        parseInt(process.env.MASTER_DB_PORT || '5432'),
        tenantDbName,
        tenantDbUser,
        tenantDbPassword
      );
      await initializeTenantDatabase(tenantPool, body.subscriberId);

      const subscriber = subscriberResult.rows[0];

      return NextResponse.json<ApiResponse>({
        success: true,
        message: 'Subscriber created successfully with tenant database',
        data: {
          id: subscriber.id,
          subscriberName: subscriber.subscriber_name,
          subscriberId: subscriber.subscriber_id,
          subscriberURL: subscriber.subscriber_url,
          subscriberUsername: subscriber.subscriber_username,
          subscriberAuthToken: subscriber.subscriber_auth_token,
          tenantDatabase: tenantDbName,
          createdAt: subscriber.created_at,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating subscriber:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: `Failed to create subscriber: ${(error as Error).message}` },
      { status: 500 }
    );
  } finally {
    await adminPool.end();
  }
}
