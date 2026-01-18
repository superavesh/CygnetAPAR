import { NextRequest, NextResponse } from 'next/server';
import { getMasterPool, getTenantPool } from '@/lib/db';
import { ApiResponse } from '@/types';

// GET filter options (modules, gstins) for a subscriber
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subscriberId = searchParams.get('subscriberId');

  if (!subscriberId) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'subscriberId is required' },
      { status: 400 }
    );
  }

  const masterPool = getMasterPool();

  try {
    const tenantResult = await masterPool.query(
      `SELECT t.database_name, t.db_host, t.db_port, t.db_user, t.db_password
       FROM tenants t
       WHERE t.subscriber_id = $1 AND t.is_active = true`,
      [subscriberId]
    );

    if (tenantResult.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber not found' },
        { status: 404 }
      );
    }

    const tenant = tenantResult.rows[0];
    const tenantPool = getTenantPool(
      tenant.db_host,
      tenant.db_port,
      tenant.database_name,
      tenant.db_user,
      tenant.db_password
    );

    // Check if transaction_logs table exists
    const tableExists = await tenantPool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'transaction_logs'
      )
    `);

    if (!tableExists.rows[0].exists) {
      return NextResponse.json<ApiResponse>({
        success: true,
        data: {
          modules: [],
          gstins: [],
        },
      });
    }

    const modulesResult = await tenantPool.query(
      `SELECT DISTINCT module FROM transaction_logs ORDER BY module`
    );

    const gstinsResult = await tenantPool.query(
      `SELECT DISTINCT gstin FROM transaction_logs WHERE gstin IS NOT NULL ORDER BY gstin`
    );

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        modules: modulesResult.rows.map(r => r.module),
        gstins: gstinsResult.rows.map(r => r.gstin),
      },
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch filter options' },
      { status: 500 }
    );
  }
}
