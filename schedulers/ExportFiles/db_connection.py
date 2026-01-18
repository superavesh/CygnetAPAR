"""
Database connection module for the Export Scheduler Service
"""
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Generator, List, Dict, Any, Optional
import json
from datetime import datetime
from config import db_config
import logging

logger = logging.getLogger(__name__)


@contextmanager
def get_master_connection() -> Generator:
    """Get a connection to the master database"""
    conn = None
    try:
        conn = psycopg2.connect(
            host=db_config.host,
            port=db_config.port,
            database=db_config.database,
            user=db_config.user,
            password=db_config.password
        )
        yield conn
    except Exception as e:
        logger.error(f"Error connecting to master database: {e}")
        raise
    finally:
        if conn:
            conn.close()


@contextmanager
def get_tenant_connection(db_name: str, db_host: str = None, db_port: int = None,
                          db_user: str = None, db_password: str = None) -> Generator:
    """Get a connection to a tenant database"""
    conn = None
    try:
        conn = psycopg2.connect(
            host=db_host or db_config.host,
            port=db_port or db_config.port,
            database=db_name,
            user=db_user or db_config.user,
            password=db_password or db_config.password
        )
        yield conn
    except Exception as e:
        logger.error(f"Error connecting to tenant database {db_name}: {e}")
        raise
    finally:
        if conn:
            conn.close()


def get_active_export_tasks() -> List[Dict[str, Any]]:
    """Fetch all active export tasks from the master database"""
    query = """
        SELECT
            st.id,
            st.subscriber_id,
            st.task_name,
            st.task_description,
            st.cron_expression,
            st.task_type,
            st.task_config,
            st.is_active,
            st.start_datetime,
            st.last_from_stamp,
            st.last_to_stamp,
            st.is_initial_sync_complete,
            st.last_run_at,
            st.next_run_at,
            s.subscriber_name,
            s.subscriber_url,
            s.subscriber_auth_token,
            t.database_name,
            t.db_host,
            t.db_port,
            t.db_user,
            t.db_password
        FROM scheduled_tasks st
        JOIN subscribers s ON st.subscriber_id = s.subscriber_id
        JOIN tenants t ON st.subscriber_id = t.subscriber_id
        WHERE st.is_active = true
        AND st.task_type = 'export'
        AND t.is_active = true
        ORDER BY st.id
    """

    with get_master_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query)
            tasks = cur.fetchall()
            return [dict(task) for task in tasks]


def get_entities_for_subscriber(db_name: str, db_host: str, db_port: int,
                                 db_user: str, db_password: str) -> List[Dict[str, Any]]:
    """Fetch all entities (GSTINs) from tenant database"""
    query = """
        SELECT DISTINCT gstin
        FROM entities
        WHERE gstin IS NOT NULL AND gstin != ''
    """

    with get_tenant_connection(db_name, db_host, db_port, db_user, db_password) as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query)
            entities = cur.fetchall()
            return [dict(entity) for entity in entities]


def update_task_progress(task_id: int, from_stamp: str, to_stamp: str,
                         is_initial_sync_complete: bool = False) -> None:
    """Update task progress in the master database"""
    query = """
        UPDATE scheduled_tasks
        SET last_from_stamp = %s,
            last_to_stamp = %s,
            is_initial_sync_complete = %s,
            last_run_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
    """

    with get_master_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (from_stamp, to_stamp, is_initial_sync_complete, task_id))
            conn.commit()
            logger.info(f"Updated task {task_id} progress: from={from_stamp}, to={to_stamp}, initial_sync={is_initial_sync_complete}")


def log_task_execution(task_id: int, subscriber_id: str, status: str,
                       error_message: str = None, execution_details: dict = None) -> int:
    """Log task execution in the master database"""
    insert_query = """
        INSERT INTO task_execution_logs
        (task_id, subscriber_id, status, started_at, execution_details)
        VALUES (%s, %s, %s, CURRENT_TIMESTAMP, %s)
        RETURNING id
    """

    import json
    details_json = json.dumps(execution_details or {})

    with get_master_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(insert_query, (task_id, subscriber_id, status, details_json))
            log_id = cur.fetchone()[0]
            conn.commit()
            return log_id


def update_task_execution_log(log_id: int, status: str, error_message: str = None,
                               execution_details: dict = None) -> None:
    """Update task execution log with completion status"""
    details_json = json.dumps(execution_details or {})

    query = """
        UPDATE task_execution_logs
        SET status = %s,
            completed_at = CURRENT_TIMESTAMP,
            error_message = %s,
            execution_details = %s
        WHERE id = %s
    """

    with get_master_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, (status, error_message, details_json, log_id))
            conn.commit()


def ensure_transaction_logs_table(db_name: str, db_host: str, db_port: int,
                                   db_user: str, db_password: str) -> None:
    """Create transaction_logs table in tenant database if it doesn't exist"""
    create_table_query = """
        CREATE TABLE IF NOT EXISTS transaction_logs (
            id SERIAL PRIMARY KEY,
            module VARCHAR(50) NOT NULL,
            request_url TEXT NOT NULL,
            request_method VARCHAR(10) DEFAULT 'POST',
            request_headers JSONB,
            request_body JSONB,
            response_status_code INTEGER,
            response_headers JSONB,
            response_file_path TEXT,
            gstin VARCHAR(15),
            from_stamp TIMESTAMP,
            to_stamp TIMESTAMP,
            stamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            execution_time_ms INTEGER,
            is_success BOOLEAN DEFAULT true,
            error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_transaction_logs_module ON transaction_logs(module);
        CREATE INDEX IF NOT EXISTS idx_transaction_logs_gstin ON transaction_logs(gstin);
        CREATE INDEX IF NOT EXISTS idx_transaction_logs_stamp ON transaction_logs(stamp);
    """

    with get_tenant_connection(db_name, db_host, db_port, db_user, db_password) as conn:
        with conn.cursor() as cur:
            cur.execute(create_table_query)
            conn.commit()
            logger.info(f"Ensured transaction_logs table exists in {db_name}")


def log_api_transaction(db_name: str, db_host: str, db_port: int,
                        db_user: str, db_password: str,
                        transaction_data: Dict[str, Any]) -> int:
    """
    Log an API transaction to the tenant database

    Args:
        db_name: Tenant database name
        db_host: Database host
        db_port: Database port
        db_user: Database user
        db_password: Database password
        transaction_data: Dictionary containing transaction details

    Returns:
        ID of the inserted log record
    """
    insert_query = """
        INSERT INTO transaction_logs (
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
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
        )
        RETURNING id
    """

    with get_tenant_connection(db_name, db_host, db_port, db_user, db_password) as conn:
        with conn.cursor() as cur:
            cur.execute(insert_query, (
                transaction_data.get('module'),
                transaction_data.get('request_url'),
                transaction_data.get('request_method', 'POST'),
                json.dumps(transaction_data.get('request_headers', {})),
                json.dumps(transaction_data.get('request_body', {})),
                transaction_data.get('response_status_code'),
                json.dumps(transaction_data.get('response_headers', {})),
                transaction_data.get('response_file_path'),
                transaction_data.get('gstin'),
                transaction_data.get('from_stamp'),
                transaction_data.get('to_stamp'),
                transaction_data.get('stamp', datetime.now()),
                transaction_data.get('execution_time_ms'),
                transaction_data.get('is_success', True),
                transaction_data.get('error_message')
            ))
            log_id = cur.fetchone()[0]
            conn.commit()
            logger.info(f"Logged API transaction {log_id} for module {transaction_data.get('module')}")
            return log_id
