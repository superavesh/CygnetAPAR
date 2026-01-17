import { NextRequest, NextResponse } from 'next/server';
import { getMasterPool } from '@/lib/db';
import { ApiResponse } from '@/types';
import bcrypt from 'bcryptjs';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Fetch a specific subscriber by ID
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const pool = getMasterPool();
  const { id: subscriberId } = await params;

  try {
    const result = await pool.query(
      `SELECT
        s.id,
        s.subscriber_name,
        s.subscriber_id,
        s.subscriber_url,
        s.subscriber_username,
        s.subscriber_auth_token,
        s.created_at,
        s.updated_at,
        t.database_name,
        t.db_host,
        t.db_port,
        t.is_active as tenant_active
      FROM subscribers s
      LEFT JOIN tenants t ON s.subscriber_id = t.subscriber_id
      WHERE s.subscriber_id = $1`,
      [subscriberId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber not found' },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    const subscriber = {
      id: row.id,
      subscriberName: row.subscriber_name,
      subscriberId: row.subscriber_id,
      subscriberURL: row.subscriber_url,
      subscriberUsername: row.subscriber_username,
      subscriberAuthToken: row.subscriber_auth_token,
      tenantActive: row.tenant_active,
      databaseName: row.database_name,
      dbHost: row.db_host,
      dbPort: row.db_port,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return NextResponse.json<ApiResponse>({
      success: true,
      data: subscriber,
    });
  } catch (error) {
    console.error('Error fetching subscriber:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch subscriber' },
      { status: 500 }
    );
  }
}

// PUT - Update a subscriber
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  const pool = getMasterPool();
  const { id: subscriberId } = await params;

  try {
    const body = await request.json();

    // Build update query dynamically based on provided fields
    const updateFields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.subscriberName) {
      updateFields.push(`subscriber_name = $${paramIndex++}`);
      values.push(body.subscriberName);
    }
    if (body.subscriberURL) {
      updateFields.push(`subscriber_url = $${paramIndex++}`);
      values.push(body.subscriberURL);
    }
    if (body.subscriberUsername) {
      updateFields.push(`subscriber_username = $${paramIndex++}`);
      values.push(body.subscriberUsername);
    }
    if (body.subscriberPassword) {
      const hashedPassword = await bcrypt.hash(body.subscriberPassword, 10);
      updateFields.push(`subscriber_password = $${paramIndex++}`);
      values.push(hashedPassword);
    }
    if (body.subscriberAuthToken) {
      updateFields.push(`subscriber_auth_token = $${paramIndex++}`);
      values.push(body.subscriberAuthToken);
    }

    if (updateFields.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(subscriberId);

    const result = await pool.query(
      `UPDATE subscribers
       SET ${updateFields.join(', ')}
       WHERE subscriber_id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber not found' },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Subscriber updated successfully',
      data: {
        id: row.id,
        subscriberName: row.subscriber_name,
        subscriberId: row.subscriber_id,
        subscriberURL: row.subscriber_url,
        subscriberUsername: row.subscriber_username,
        subscriberAuthToken: row.subscriber_auth_token,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Error updating subscriber:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to update subscriber' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a subscriber and its tenant database
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const pool = getMasterPool();
  const { id: subscriberId } = await params;

  try {
    // Get tenant info before deletion
    const tenantResult = await pool.query(
      'SELECT database_name, db_user FROM tenants WHERE subscriber_id = $1',
      [subscriberId]
    );

    // Delete subscriber (cascade will delete tenant record)
    const result = await pool.query(
      'DELETE FROM subscribers WHERE subscriber_id = $1 RETURNING *',
      [subscriberId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber not found' },
        { status: 404 }
      );
    }

    // Note: The actual tenant database is not dropped automatically
    // This is intentional to prevent accidental data loss
    // Admin can manually drop the database if needed

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Subscriber deleted successfully',
      data: {
        deletedSubscriberId: subscriberId,
        tenantDatabase: tenantResult.rows[0]?.database_name,
        note: 'Tenant database was not dropped automatically. Please drop it manually if needed.',
      },
    });
  } catch (error) {
    console.error('Error deleting subscriber:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to delete subscriber' },
      { status: 500 }
    );
  }
}
