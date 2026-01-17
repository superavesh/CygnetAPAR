"""
CSV Processor Lambda Function
Consumes messages from RabbitMQ, reads CSV from EFS, inserts data into PostgreSQL
"""

import json
import os
import csv
from datetime import datetime
from typing import Dict, List, Any, Generator
import pika
import psycopg2
from psycopg2.extras import execute_batch
from psycopg2.pool import SimpleConnectionPool

# Environment variables
RABBITMQ_HOST = os.environ['RABBITMQ_HOST']
RABBITMQ_PORT = int(os.environ.get('RABBITMQ_PORT', 5672))
RABBITMQ_USERNAME = os.environ['RABBITMQ_USERNAME']
RABBITMQ_PASSWORD = os.environ['RABBITMQ_PASSWORD']
FILE_PROCESSING_QUEUE = os.environ.get('FILE_PROCESSING_QUEUE', 'file_processing_queue')
EFS_MOUNT_PATH = os.environ.get('EFS_MOUNT_PATH', '/mnt/efs/data')
DB_HOST = os.environ['DB_HOST']
DB_PORT = int(os.environ.get('DB_PORT', 5432))
DB_NAME = os.environ['DB_NAME']
DB_USERNAME = os.environ['DB_USERNAME']
DB_PASSWORD = os.environ['DB_PASSWORD']
BATCH_INSERT_SIZE = int(os.environ.get('BATCH_INSERT_SIZE', 1000))

# Connection pool (reused across Lambda invocations)
db_pool = None


def get_db_pool():
    """Get or create database connection pool"""
    global db_pool
    if db_pool is None:
        db_pool = SimpleConnectionPool(
            1,  # minconn
            5,  # maxconn
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USERNAME,
            password=DB_PASSWORD,
            connect_timeout=10
        )
    return db_pool


class DatabaseManager:
    """Manages PostgreSQL database operations"""
    
    def __init__(self):
        self.pool = get_db_pool()
        self.conn = self.pool.getconn()
        self.cursor = None
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.cursor:
            self.cursor.close()
        self.pool.putconn(self.conn)
    
    def begin_transaction(self):
        """Begin database transaction"""
        self.cursor = self.conn.cursor()
        self.conn.autocommit = False
    
    def commit_transaction(self):
        """Commit database transaction"""
        self.conn.commit()
    
    def rollback_transaction(self):
        """Rollback database transaction"""
        self.conn.rollback()
    
    def insert_file_metadata(self, file_data: Dict[str, Any]):
        """
        Insert file processing metadata
        
        Args:
            file_data: File metadata dictionary
        """
        query = """
            INSERT INTO file_processing_metadata (
                file_id, location_id, subscriber_id, efs_path,
                file_size, row_count, checksum, status,
                processing_started_at, created_at
            ) VALUES (
                %(file_id)s, %(location_id)s, %(subscriber_id)s, %(efs_path)s,
                %(file_size)s, %(row_count)s, %(checksum)s, 'processing',
                CURRENT_TIMESTAMP, %(created_at)s
            )
            ON CONFLICT (file_id) DO UPDATE SET
                status = 'processing',
                processing_started_at = CURRENT_TIMESTAMP
        """
        self.cursor.execute(query, file_data)
    
    def update_file_status(self, file_id: str, status: str, error_message: str = None):
        """
        Update file processing status
        
        Args:
            file_id: File identifier
            status: Processing status (completed/failed)
            error_message: Error message if failed
        """
        query = """
            UPDATE file_processing_metadata
            SET status = %s,
                processing_completed_at = CURRENT_TIMESTAMP,
                error_message = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE file_id = %s
        """
        self.cursor.execute(query, (status, error_message, file_id))
    
    def batch_insert_data(self, rows: List[Dict[str, Any]], file_id: str):
        """
        Insert data rows in batch
        
        Args:
            rows: List of data rows
            file_id: File identifier for tracking
        """
        if not rows:
            return
        
        # Dynamically build INSERT query based on first row's keys
        # Adjust column names based on your actual table schema
        columns = list(rows[0].keys()) + ['file_id', 'created_at']
        
        placeholders = ', '.join(['%s'] * len(columns))
        column_names = ', '.join(columns)
        
        query = f"""
            INSERT INTO subscriber_location_data ({column_names})
            VALUES ({placeholders})
            ON CONFLICT (location_id, subscriber_id, data_column_1) 
            DO UPDATE SET
                data_column_2 = EXCLUDED.data_column_2,
                data_column_3 = EXCLUDED.data_column_3,
                updated_at = CURRENT_TIMESTAMP
        """
        
        # Prepare values for batch insert
        values = []
        for row in rows:
            row_values = [row.get(col) for col in rows[0].keys()]
            row_values.extend([file_id, datetime.utcnow()])
            values.append(tuple(row_values))
        
        # Use execute_batch for efficient batch inserts
        execute_batch(self.cursor, query, values, page_size=BATCH_INSERT_SIZE)


def read_csv_in_batches(filepath: str, batch_size: int = 1000) -> Generator[List[Dict[str, Any]], None, None]:
    """
    Read CSV file in batches
    
    Args:
        filepath: Path to CSV file
        batch_size: Number of rows per batch
    
    Yields:
        List of dictionaries representing rows
    """
    with open(filepath, 'r', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        
        batch = []
        for row in reader:
            batch.append(row)
            
            if len(batch) >= batch_size:
                yield batch
                batch = []
        
        # Yield remaining rows
        if batch:
            yield batch


def validate_csv_file(filepath: str) -> Dict[str, Any]:
    """
    Validate CSV file structure and content
    
    Args:
        filepath: Path to CSV file
    
    Returns:
        Dict containing validation results
    """
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"CSV file not found: {filepath}")
    
    file_size = os.path.getsize(filepath)
    if file_size == 0:
        raise ValueError("CSV file is empty")
    
    # Check file is readable and has valid CSV structure
    with open(filepath, 'r', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        try:
            first_row = next(reader)
            if not first_row:
                raise ValueError("CSV file has no data rows")
            
            # Verify required columns exist
            required_columns = ['location_id', 'subscriber_id']  # Adjust based on your needs
            missing_columns = [col for col in required_columns if col not in first_row]
            if missing_columns:
                raise ValueError(f"CSV missing required columns: {missing_columns}")
            
        except StopIteration:
            raise ValueError("CSV file has headers but no data rows")
    
    return {
        'valid': True,
        'file_size': file_size
    }


def archive_processed_file(filepath: str) -> str:
    """
    Move processed file to archive directory
    
    Args:
        filepath: Current file path
    
    Returns:
        New archived file path
    """
    filename = os.path.basename(filepath)
    archive_path = os.path.join(EFS_MOUNT_PATH, 'archive', filename)
    os.makedirs(os.path.dirname(archive_path), exist_ok=True)
    
    # Move file to archive
    os.rename(filepath, archive_path)
    return archive_path


def move_failed_file(filepath: str) -> str:
    """
    Move failed file to failed directory
    
    Args:
        filepath: Current file path
    
    Returns:
        New file path
    """
    filename = os.path.basename(filepath)
    failed_path = os.path.join(EFS_MOUNT_PATH, 'failed', filename)
    os.makedirs(os.path.dirname(failed_path), exist_ok=True)
    
    # Move file to failed directory
    os.rename(filepath, failed_path)
    return failed_path


def process_csv_file(file_message: Dict[str, Any]):
    """
    Process CSV file and insert data into PostgreSQL
    
    Args:
        file_message: Message containing file metadata
    """
    file_id = file_message['file_id']
    location_id = file_message['location_id']
    subscriber_id = file_message['subscriber_id']
    efs_path = file_message['efs_path']
    
    print(f"Processing file {file_id}: {efs_path}")
    print(f"Location: {location_id}, Subscriber: {subscriber_id}")
    
    # Validate CSV file
    try:
        validation_result = validate_csv_file(efs_path)
        print(f"File validation passed: {validation_result}")
    except Exception as e:
        print(f"File validation failed: {str(e)}")
        move_failed_file(efs_path)
        raise
    
    # Process file with database transaction
    with DatabaseManager() as db:
        try:
            db.begin_transaction()
            
            # Insert file metadata
            db.insert_file_metadata(file_message)
            
            # Read and insert CSV data in batches
            total_rows = 0
            batch_count = 0
            
            for batch in read_csv_in_batches(efs_path, BATCH_INSERT_SIZE):
                batch_count += 1
                batch_size = len(batch)
                total_rows += batch_size
                
                print(f"Inserting batch {batch_count} ({batch_size} rows)")
                db.batch_insert_data(batch, file_id)
            
            # Update file status to completed
            db.update_file_status(file_id, 'completed')
            
            # Commit transaction
            db.commit_transaction()
            
            print(f"Successfully processed {total_rows} rows in {batch_count} batches")
            
            # Archive the processed file
            archive_path = archive_processed_file(efs_path)
            print(f"File archived to: {archive_path}")
            
        except Exception as e:
            print(f"Error processing file: {str(e)}")
            
            # Rollback transaction
            db.rollback_transaction()
            
            # Update file status to failed
            try:
                db.begin_transaction()
                db.update_file_status(file_id, 'failed', str(e))
                db.commit_transaction()
            except Exception as update_error:
                print(f"Failed to update error status: {str(update_error)}")
            
            # Move file to failed directory
            move_failed_file(efs_path)
            
            raise


def lambda_handler(event, context):
    """
    Lambda handler for RabbitMQ event source
    
    Args:
        event: Lambda event containing RabbitMQ messages
        context: Lambda context
    
    Returns:
        Dict with status code
    """
    try:
        # Process messages from event
        for record in event.get('rmqMessagesByQueue', {}).get(FILE_PROCESSING_QUEUE, []):
            message_body = json.loads(record['data'])
            
            try:
                # Process the CSV file
                process_csv_file(message_body)
                
            except Exception as e:
                print(f"Error processing message: {str(e)}")
                # Message will be retried or sent to DLQ based on configuration
                raise
        
        return {
            'statusCode': 200,
            'body': json.dumps('CSV processing completed successfully')
        }
    
    except Exception as e:
        print(f"Lambda execution error: {str(e)}")
        raise


if __name__ == "__main__":
    # For local testing
    import uuid
    
    test_event = {
        'rmqMessagesByQueue': {
            FILE_PROCESSING_QUEUE: [
                {
                    'data': json.dumps({
                        'file_id': str(uuid.uuid4()),
                        'location_id': 'LOC001',
                        'subscriber_id': 'SUB001',
                        'efs_path': '/mnt/efs/data/completed/LOC001_SUB001_20260114_103000.csv',
                        'file_size': 1048576,
                        'row_count': 10000,
                        'created_at': datetime.utcnow().isoformat(),
                        'checksum': 'abc123def456'
                    })
                }
            ]
        }
    }
    
    lambda_handler(test_event, None)
