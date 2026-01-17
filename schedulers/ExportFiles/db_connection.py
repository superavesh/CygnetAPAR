"""
Database connection module for the Export Scheduler Service
"""
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Generator, List, Dict, Any, Optional
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
    import json
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
