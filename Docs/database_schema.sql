-- PostgreSQL Database Schema for Data Processing Pipeline
-- Run this script after creating the database

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create locations table (optional - for managing location data)
CREATE TABLE IF NOT EXISTS locations (
    location_id VARCHAR(50) PRIMARY KEY,
    location_name VARCHAR(255) NOT NULL,
    region VARCHAR(100),
    country VARCHAR(100),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create subscribers table (optional - for managing subscriber data)
CREATE TABLE IF NOT EXISTS subscribers (
    subscriber_id VARCHAR(50) PRIMARY KEY,
    subscriber_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create file processing metadata table
CREATE TABLE IF NOT EXISTS file_processing_metadata (
    file_id UUID PRIMARY KEY,
    location_id VARCHAR(50) NOT NULL,
    subscriber_id VARCHAR(50) NOT NULL,
    efs_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    row_count INTEGER,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP,
    error_message TEXT,
    checksum VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create main data table (adjust columns based on your actual data structure)
CREATE TABLE IF NOT EXISTS subscriber_location_data (
    id BIGSERIAL PRIMARY KEY,
    location_id VARCHAR(50) NOT NULL,
    subscriber_id VARCHAR(50) NOT NULL,
    
    -- Replace these columns with your actual data columns
    data_column_1 VARCHAR(255),
    data_column_2 NUMERIC(15, 2),
    data_column_3 TIMESTAMP,
    data_column_4 TEXT,
    data_column_5 INTEGER,
    
    -- Additional fields
    file_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Add constraint for duplicate prevention
    CONSTRAINT unique_subscriber_location_record UNIQUE (location_id, subscriber_id, data_column_1),
    
    -- Foreign key to file metadata
    CONSTRAINT fk_file_id FOREIGN KEY (file_id) 
        REFERENCES file_processing_metadata(file_id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_location_subscriber 
    ON subscriber_location_data(location_id, subscriber_id);

CREATE INDEX IF NOT EXISTS idx_created_at 
    ON subscriber_location_data(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_id 
    ON subscriber_location_data(file_id);

CREATE INDEX IF NOT EXISTS idx_data_column_1 
    ON subscriber_location_data(data_column_1);

CREATE INDEX IF NOT EXISTS idx_processing_status 
    ON file_processing_metadata(status);

CREATE INDEX IF NOT EXISTS idx_location_subscriber_meta 
    ON file_processing_metadata(location_id, subscriber_id);

CREATE INDEX IF NOT EXISTS idx_file_created_at 
    ON file_processing_metadata(created_at DESC);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_locations_updated_at 
    BEFORE UPDATE ON locations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscribers_updated_at 
    BEFORE UPDATE ON subscribers 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_file_metadata_updated_at 
    BEFORE UPDATE ON file_processing_metadata 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriber_location_data_updated_at 
    BEFORE UPDATE ON subscriber_location_data 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create view for easy monitoring of file processing
CREATE OR REPLACE VIEW v_file_processing_summary AS
SELECT 
    status,
    COUNT(*) as file_count,
    SUM(row_count) as total_rows,
    SUM(file_size) as total_size_bytes,
    AVG(EXTRACT(EPOCH FROM (processing_completed_at - processing_started_at))) as avg_processing_time_seconds,
    MIN(created_at) as earliest_file,
    MAX(created_at) as latest_file
FROM file_processing_metadata
GROUP BY status;

-- Create view for data quality monitoring
CREATE OR REPLACE VIEW v_data_quality_check AS
SELECT 
    location_id,
    subscriber_id,
    COUNT(*) as record_count,
    COUNT(DISTINCT file_id) as file_count,
    MIN(created_at) as first_record_date,
    MAX(created_at) as last_record_date
FROM subscriber_location_data
GROUP BY location_id, subscriber_id;

-- Create materialized view for performance (refresh periodically)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_processing_stats AS
SELECT 
    DATE(created_at) as processing_date,
    COUNT(DISTINCT file_id) as files_processed,
    SUM(row_count) as rows_processed,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as successful_files,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_files,
    AVG(CASE 
        WHEN status = 'completed' 
        THEN EXTRACT(EPOCH FROM (processing_completed_at - processing_started_at))
    END) as avg_processing_time_seconds
FROM file_processing_metadata
GROUP BY DATE(created_at)
ORDER BY processing_date DESC;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_stats_date 
    ON mv_daily_processing_stats(processing_date);

-- Sample data for testing (optional)
INSERT INTO locations (location_id, location_name, region, country) VALUES
    ('LOC001', 'New York Office', 'North America', 'USA'),
    ('LOC002', 'London Office', 'Europe', 'UK'),
    ('LOC003', 'Tokyo Office', 'Asia Pacific', 'Japan')
ON CONFLICT (location_id) DO NOTHING;

INSERT INTO subscribers (subscriber_id, subscriber_name, email) VALUES
    ('SUB001', 'Subscriber Alpha', 'alpha@example.com'),
    ('SUB002', 'Subscriber Beta', 'beta@example.com'),
    ('SUB003', 'Subscriber Gamma', 'gamma@example.com'),
    ('SUB004', 'Subscriber Delta', 'delta@example.com'),
    ('SUB005', 'Subscriber Epsilon', 'epsilon@example.com')
ON CONFLICT (subscriber_id) DO NOTHING;

-- Grant permissions (adjust based on your security requirements)
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO your_app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO your_app_user;

-- Create function to refresh materialized view (can be called daily)
CREATE OR REPLACE FUNCTION refresh_daily_stats()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_processing_stats;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE file_processing_metadata IS 'Tracks metadata for all CSV files processed through the pipeline';
COMMENT ON TABLE subscriber_location_data IS 'Main table containing data from API calls for each subscriber-location combination';
COMMENT ON COLUMN file_processing_metadata.status IS 'Processing status: pending, processing, completed, or failed';
COMMENT ON COLUMN file_processing_metadata.checksum IS 'SHA-256 checksum of the CSV file for integrity verification';
COMMENT ON VIEW v_file_processing_summary IS 'Summary statistics of file processing by status';
COMMENT ON VIEW v_data_quality_check IS 'Data quality metrics by location and subscriber';

-- Partitioning strategy (for very large tables - optional)
-- If you expect billions of rows, consider partitioning by date
/*
CREATE TABLE subscriber_location_data_partitioned (
    LIKE subscriber_location_data INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Create monthly partitions
CREATE TABLE subscriber_location_data_y2026m01 
    PARTITION OF subscriber_location_data_partitioned
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE subscriber_location_data_y2026m02 
    PARTITION OF subscriber_location_data_partitioned
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- Continue creating partitions as needed...
*/

-- Performance tuning settings (adjust in postgresql.conf or via RDS parameter group)
/*
Recommended settings for this workload:
- shared_buffers = 25% of RAM
- effective_cache_size = 75% of RAM
- work_mem = 50MB (for sorting/aggregation)
- maintenance_work_mem = 1GB (for VACUUM, CREATE INDEX)
- max_connections = 100
- checkpoint_completion_target = 0.9
- wal_buffers = 16MB
- random_page_cost = 1.1 (for SSD)
- effective_io_concurrency = 200 (for SSD)
*/
