import { NextRequest, NextResponse } from 'next/server';
import { getMasterPool, getTenantPool } from '@/lib/db';
import { syncEntitiesForSubscriber } from '@/lib/entity-service';
import { ApiResponse } from '@/types';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Fetch entities for a specific subscriber with pagination
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const masterPool = getMasterPool();
  const { id: subscriberId } = await params;
  const { searchParams } = new URL(request.url);

  // Pagination parameters
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '20');
  const offset = (page - 1) * limit;

  // Search/filter parameters
  const search = searchParams.get('search') || '';
  const sortBy = searchParams.get('sortBy') || 'created_at';
  const sortOrder = searchParams.get('sortOrder') || 'DESC';

  // Validate sort parameters
  const allowedSortFields = ['legal_name', 'gstin', 'pan', 'state_name', 'registration_status', 'created_at'];
  const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
  const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  try {
    // Get tenant database connection details
    const tenantResult = await masterPool.query(
      `SELECT t.database_name, t.db_host, t.db_port, t.db_user, t.db_password, s.subscriber_name
       FROM tenants t
       JOIN subscribers s ON t.subscriber_id = s.subscriber_id
       WHERE t.subscriber_id = $1 AND t.is_active = true`,
      [subscriberId]
    );

    if (tenantResult.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber or tenant database not found' },
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

    // Build search condition
    let searchCondition = '';
    const queryParams: (string | number)[] = [];
    let paramIndex = 1;

    if (search) {
      searchCondition = `
        WHERE (
          legal_name ILIKE $${paramIndex} OR
          trade_name ILIKE $${paramIndex} OR
          gstin ILIKE $${paramIndex} OR
          pan ILIKE $${paramIndex} OR
          state_name ILIKE $${paramIndex}
        )
      `;
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM entities ${searchCondition}`;
    const countResult = await tenantPool.query(countQuery, queryParams.slice(0, paramIndex - 1));
    const total = parseInt(countResult.rows[0].total);

    // Get entities with pagination
    const entitiesQuery = `
      SELECT
        id,
        entity_id,
        legal_name,
        trade_name,
        gstin,
        pan,
        entity_type,
        registration_status,
        state_code,
        state_name,
        address,
        pincode,
        email,
        phone,
        constitution_of_business,
        taxpayer_type,
        registration_date,
        cancellation_date,
        last_updated_date,
        created_at,
        updated_at
      FROM entities
      ${searchCondition}
      ORDER BY ${validSortBy} ${validSortOrder}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    queryParams.push(limit, offset);
    const entitiesResult = await tenantPool.query(entitiesQuery, queryParams);

    const entities = entitiesResult.rows.map(row => ({
      id: row.id,
      entityId: row.entity_id,
      legalName: row.legal_name,
      tradeName: row.trade_name,
      gstin: row.gstin,
      pan: row.pan,
      entityType: row.entity_type,
      registrationStatus: row.registration_status,
      stateCode: row.state_code,
      stateName: row.state_name,
      address: row.address,
      pincode: row.pincode,
      email: row.email,
      phone: row.phone,
      constitutionOfBusiness: row.constitution_of_business,
      taxpayerType: row.taxpayer_type,
      registrationDate: row.registration_date,
      cancellationDate: row.cancellation_date,
      lastUpdatedDate: row.last_updated_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        entities,
        subscriberName: tenant.subscriber_name,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching entities:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: `Failed to fetch entities: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}

// POST - Sync entities from external API for a specific subscriber
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const masterPool = getMasterPool();
  const { id: subscriberId } = await params;

  try {
    // Get subscriber and tenant details
    const result = await masterPool.query(
      `SELECT
        s.subscriber_url,
        s.subscriber_auth_token,
        t.database_name,
        t.db_host,
        t.db_port,
        t.db_user,
        t.db_password
       FROM subscribers s
       JOIN tenants t ON s.subscriber_id = t.subscriber_id
       WHERE s.subscriber_id = $1 AND t.is_active = true`,
      [subscriberId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber or tenant database not found' },
        { status: 404 }
      );
    }

    const data = result.rows[0];
    const tenantPool = getTenantPool(
      data.db_host,
      data.db_port,
      data.database_name,
      data.db_user,
      data.db_password
    );

    // Sync entities from external API
    const syncResult = await syncEntitiesForSubscriber(
      data.subscriber_url,
      data.subscriber_auth_token,
      tenantPool
    );

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Entities synced successfully',
      data: {
        totalFetched: syncResult.totalFetched,
        totalInserted: syncResult.totalInserted,
      },
    });
  } catch (error) {
    console.error('Error syncing entities:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: `Failed to sync entities: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
