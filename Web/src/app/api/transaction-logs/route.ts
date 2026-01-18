import { NextRequest, NextResponse } from 'next/server';
import { getMasterPool, getTenantPool } from '@/lib/db';
import { ApiResponse } from '@/types';

interface TransactionLog {
  id: number;
  module: string;
  requestUrl: string;
  requestMethod: string;
  requestHeaders: Record<string, unknown>;
  requestBody: Record<string, unknown>;
  responseStatusCode: number;
  responseHeaders: Record<string, unknown>;
  responseFilePath: string | null;
  gstin: string;
  fromStamp: string | null;
  toStamp: string | null;
  stamp: string;
  executionTimeMs: number;
  isSuccess: boolean;
  errorMessage: string | null;
}

interface TransactionLogsResponse {
  logs: TransactionLog[];
  total: number;
  page: number;
  pageSize: number;
  subscriberName: string;
  databaseName: string;
}

// GET - Fetch transaction logs for a subscriber
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const subscriberId = searchParams.get('subscriberId');
  const module = searchParams.get('module');
  const gstin = searchParams.get('gstin');
  const isSuccess = searchParams.get('isSuccess');
  const fromDate = searchParams.get('fromDate');
  const toDate = searchParams.get('toDate');
  const search = searchParams.get('search');
  const page = parseInt(searchParams.get('page') || '1');
  const pageSize = parseInt(searchParams.get('pageSize') || '50');

  if (!subscriberId) {
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'subscriberId is required' },
      { status: 400 }
    );
  }

  const masterPool = getMasterPool();

  try {
    // Get tenant database info
    const tenantResult = await masterPool.query(
      `SELECT t.database_name, t.db_host, t.db_port, t.db_user, t.db_password, s.subscriber_name
       FROM tenants t
       JOIN subscribers s ON t.subscriber_id = s.subscriber_id
       WHERE t.subscriber_id = $1 AND t.is_active = true`,
      [subscriberId]
    );

    if (tenantResult.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber not found or inactive' },
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
      return NextResponse.json<ApiResponse<TransactionLogsResponse>>({
        success: true,
        data: {
          logs: [],
          total: 0,
          page,
          pageSize,
          subscriberName: tenant.subscriber_name,
          databaseName: tenant.database_name,
        },
      });
    }

    // Build query with filters
    const conditions: string[] = [];
    const params: (string | number | boolean)[] = [];
    let paramIndex = 1;

    if (module) {
      conditions.push(`module = $${paramIndex++}`);
      params.push(module);
    }

    if (gstin) {
      conditions.push(`gstin ILIKE $${paramIndex++}`);
      params.push(`%${gstin}%`);
    }

    if (isSuccess !== null && isSuccess !== '') {
      conditions.push(`is_success = $${paramIndex++}`);
      params.push(isSuccess === 'true');
    }

    if (fromDate) {
      conditions.push(`stamp >= $${paramIndex++}`);
      params.push(fromDate);
    }

    if (toDate) {
      conditions.push(`stamp <= $${paramIndex++}`);
      params.push(toDate);
    }

    if (search) {
      conditions.push(`(request_url ILIKE $${paramIndex} OR error_message ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await tenantPool.query(
      `SELECT COUNT(*) FROM transaction_logs ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get paginated results
    const offset = (page - 1) * pageSize;
    const logsResult = await tenantPool.query(
      `SELECT
        id,
        module,
        request_url,
        request_method,
        request_headers,
        request_body,
        response_status_code,
        response_headers,
        response_file_path,
        gstin,
        from_stamp,
        to_stamp,
        stamp,
        execution_time_ms,
        is_success,
        error_message
       FROM transaction_logs
       ${whereClause}
       ORDER BY stamp DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      [...params, pageSize, offset]
    );

    const logs: TransactionLog[] = logsResult.rows.map(row => ({
      id: row.id,
      module: row.module,
      requestUrl: row.request_url,
      requestMethod: row.request_method,
      requestHeaders: row.request_headers || {},
      requestBody: row.request_body || {},
      responseStatusCode: row.response_status_code,
      responseHeaders: row.response_headers || {},
      responseFilePath: row.response_file_path,
      gstin: row.gstin,
      fromStamp: row.from_stamp,
      toStamp: row.to_stamp,
      stamp: row.stamp,
      executionTimeMs: row.execution_time_ms,
      isSuccess: row.is_success,
      errorMessage: row.error_message,
    }));

    return NextResponse.json<ApiResponse<TransactionLogsResponse>>({
      success: true,
      data: {
        logs,
        total,
        page,
        pageSize,
        subscriberName: tenant.subscriber_name,
        databaseName: tenant.database_name,
      },
    });
  } catch (error) {
    console.error('Error fetching transaction logs:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: `Failed to fetch transaction logs: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

// GET modules for a subscriber
export async function OPTIONS(request: NextRequest) {
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
