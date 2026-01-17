import { Pool } from 'pg';

// SQL to create master database tables
export const masterDatabaseSchema = `
-- Subscribers table: stores all client/subscriber information
CREATE TABLE IF NOT EXISTS subscribers (
  id SERIAL PRIMARY KEY,
  subscriber_name VARCHAR(255) NOT NULL,
  subscriber_id VARCHAR(100) UNIQUE NOT NULL,
  subscriber_url VARCHAR(500) NOT NULL,
  subscriber_username VARCHAR(255) NOT NULL,
  subscriber_password VARCHAR(500) NOT NULL,
  subscriber_auth_token VARCHAR(500),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tenants table: stores database connection details for each tenant
CREATE TABLE IF NOT EXISTS tenants (
  id SERIAL PRIMARY KEY,
  subscriber_id VARCHAR(100) UNIQUE NOT NULL REFERENCES subscribers(subscriber_id) ON DELETE CASCADE,
  database_name VARCHAR(100) NOT NULL,
  db_host VARCHAR(255) NOT NULL DEFAULT 'localhost',
  db_port INTEGER NOT NULL DEFAULT 5432,
  db_user VARCHAR(100) NOT NULL,
  db_password VARCHAR(500) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled tasks table: stores task scheduling information
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id SERIAL PRIMARY KEY,
  subscriber_id VARCHAR(100) NOT NULL REFERENCES subscribers(subscriber_id) ON DELETE CASCADE,
  task_name VARCHAR(255) NOT NULL,
  task_description TEXT,
  cron_expression VARCHAR(100) NOT NULL,
  task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('sync', 'backup', 'report', 'custom', 'export')),
  task_config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  start_datetime TIMESTAMP WITH TIME ZONE,
  last_from_stamp TIMESTAMP WITH TIME ZONE,
  last_to_stamp TIMESTAMP WITH TIME ZONE,
  is_initial_sync_complete BOOLEAN DEFAULT false,
  last_run_at TIMESTAMP WITH TIME ZONE,
  next_run_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Task execution logs table: stores execution history
CREATE TABLE IF NOT EXISTS task_execution_logs (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  subscriber_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  execution_details JSONB DEFAULT '{}'
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_subscribers_subscriber_id ON subscribers(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_tenants_subscriber_id ON tenants(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_subscriber_id ON scheduled_tasks(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_task_execution_logs_task_id ON task_execution_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_execution_logs_subscriber_id ON task_execution_logs(subscriber_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_subscribers_updated_at ON subscribers;
CREATE TRIGGER update_subscribers_updated_at
  BEFORE UPDATE ON subscribers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheduled_tasks_updated_at ON scheduled_tasks;
CREATE TRIGGER update_scheduled_tasks_updated_at
  BEFORE UPDATE ON scheduled_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
`;

// SQL to create tenant database tables
export const tenantDatabaseSchema = `
-- Tenant-specific tables can be added here
-- This is the base schema for each tenant database

CREATE TABLE IF NOT EXISTS tenant_info (
  id SERIAL PRIMARY KEY,
  subscriber_id VARCHAR(100) NOT NULL,
  initialized_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Entities table: stores entity data fetched from external API
CREATE TABLE IF NOT EXISTS entities (
  id SERIAL PRIMARY KEY,
  entity_id VARCHAR(100) UNIQUE,
  legal_name VARCHAR(500),
  trade_name VARCHAR(500),
  gstin VARCHAR(20),
  pan VARCHAR(20),
  entity_type VARCHAR(100),
  registration_status VARCHAR(100),
  state_code VARCHAR(10),
  state_name VARCHAR(100),
  address TEXT,
  pincode VARCHAR(10),
  email VARCHAR(255),
  phone VARCHAR(50),
  constitution_of_business VARCHAR(255),
  taxpayer_type VARCHAR(100),
  registration_date DATE,
  cancellation_date DATE,
  last_updated_date DATE,
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on commonly searched fields
CREATE INDEX IF NOT EXISTS idx_entities_gstin ON entities(gstin);
CREATE INDEX IF NOT EXISTS idx_entities_pan ON entities(pan);
CREATE INDEX IF NOT EXISTS idx_entities_legal_name ON entities(legal_name);
CREATE INDEX IF NOT EXISTS idx_entities_entity_id ON entities(entity_id);

-- Tenant settings table
CREATE TABLE IF NOT EXISTS tenant_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenant_logs (
  id SERIAL PRIMARY KEY,
  log_type VARCHAR(50) NOT NULL,
  log_message TEXT,
  log_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Trigger for entities updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_entities_updated_at ON entities;
CREATE TRIGGER update_entities_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
`;

export async function initializeMasterDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(masterDatabaseSchema);
    console.log('Master database schema initialized successfully');
  } finally {
    client.release();
  }
}

export async function initializeTenantDatabase(pool: Pool, subscriberId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(tenantDatabaseSchema);
    await client.query(
      'INSERT INTO tenant_info (subscriber_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [subscriberId]
    );
    console.log(`Tenant database for ${subscriberId} initialized successfully`);
  } finally {
    client.release();
  }
}
