import { Pool, PoolConfig } from 'pg';

// Master database connection pool
const masterDbConfig: PoolConfig = {
  host: process.env.MASTER_DB_HOST || 'localhost',
  port: parseInt(process.env.MASTER_DB_PORT || '5432'),
  database: process.env.MASTER_DB_NAME || 'MasterDatabase',
  user: process.env.MASTER_DB_USER || 'postgres',
  password: process.env.MASTER_DB_PASSWORD || '',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Singleton pattern for master database pool
let masterPool: Pool | null = null;

export function getMasterPool(): Pool {
  if (!masterPool) {
    masterPool = new Pool(masterDbConfig);

    masterPool.on('error', (err) => {
      console.error('Unexpected error on master database pool', err);
    });
  }
  return masterPool;
}

// Cache for tenant connection pools
const tenantPools: Map<string, Pool> = new Map();

export function getTenantPool(
  dbHost: string,
  dbPort: number,
  dbName: string,
  dbUser: string,
  dbPassword: string
): Pool {
  const poolKey = `${dbHost}:${dbPort}:${dbName}`;

  if (!tenantPools.has(poolKey)) {
    const tenantConfig: PoolConfig = {
      host: dbHost,
      port: dbPort,
      database: dbName,
      user: dbUser,
      password: dbPassword,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    };

    const pool = new Pool(tenantConfig);

    pool.on('error', (err) => {
      console.error(`Unexpected error on tenant pool ${poolKey}`, err);
    });

    tenantPools.set(poolKey, pool);
  }

  return tenantPools.get(poolKey)!;
}

// Get tenant pool by subscriberId
export async function getTenantPoolBySubscriberId(subscriberId: string): Promise<Pool | null> {
  const masterPool = getMasterPool();

  try {
    const result = await masterPool.query(
      `SELECT database_name, db_host, db_port, db_user, db_password
       FROM tenants
       WHERE subscriber_id = $1 AND is_active = true`,
      [subscriberId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const tenant = result.rows[0];
    return getTenantPool(
      tenant.db_host,
      tenant.db_port,
      tenant.database_name,
      tenant.db_user,
      tenant.db_password
    );
  } catch (error) {
    console.error('Error getting tenant pool:', error);
    return null;
  }
}

// Admin connection for creating databases
export function getAdminPool(): Pool {
  const adminConfig: PoolConfig = {
    host: process.env.MASTER_DB_HOST || 'localhost',
    port: parseInt(process.env.MASTER_DB_PORT || '5432'),
    database: 'postgres', // Connect to default postgres database
    user: process.env.PG_ADMIN_USER || 'postgres',
    password: process.env.PG_ADMIN_PASSWORD || '',
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };

  return new Pool(adminConfig);
}

// Close all pools gracefully
export async function closeAllPools(): Promise<void> {
  if (masterPool) {
    await masterPool.end();
    masterPool = null;
  }

  for (const [key, pool] of tenantPools) {
    await pool.end();
    tenantPools.delete(key);
  }
}
