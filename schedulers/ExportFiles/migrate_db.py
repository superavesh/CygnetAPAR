"""
Database migration script to add new columns to scheduled_tasks table
"""
import psycopg2
from config import db_config
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def migrate():
    """Add new columns to scheduled_tasks table"""
    conn = None
    try:
        conn = psycopg2.connect(
            host=db_config.host,
            port=db_config.port,
            database=db_config.database,
            user=db_config.user,
            password=db_config.password
        )

        cur = conn.cursor()

        # Check if columns already exist and add them if not
        migrations = [
            ("start_datetime", "ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS start_datetime TIMESTAMP WITH TIME ZONE"),
            ("last_from_stamp", "ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS last_from_stamp TIMESTAMP WITH TIME ZONE"),
            ("last_to_stamp", "ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS last_to_stamp TIMESTAMP WITH TIME ZONE"),
            ("is_initial_sync_complete", "ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS is_initial_sync_complete BOOLEAN DEFAULT false"),
        ]

        # Also update the check constraint to include 'export' task type
        update_constraint = """
            DO $$
            BEGIN
                -- Drop old constraint if exists
                ALTER TABLE scheduled_tasks DROP CONSTRAINT IF EXISTS scheduled_tasks_task_type_check;

                -- Add new constraint with 'export' type
                ALTER TABLE scheduled_tasks ADD CONSTRAINT scheduled_tasks_task_type_check
                    CHECK (task_type IN ('sync', 'backup', 'report', 'custom', 'export'));
            EXCEPTION
                WHEN others THEN
                    RAISE NOTICE 'Constraint update skipped: %', SQLERRM;
            END $$;
        """

        for col_name, sql in migrations:
            try:
                logger.info(f"Adding column: {col_name}")
                cur.execute(sql)
                logger.info(f"Column {col_name} added successfully")
            except Exception as e:
                logger.warning(f"Column {col_name} may already exist: {e}")

        # Update task_type constraint
        try:
            logger.info("Updating task_type constraint to include 'export'")
            cur.execute(update_constraint)
            logger.info("Constraint updated successfully")
        except Exception as e:
            logger.warning(f"Constraint update failed: {e}")

        conn.commit()
        logger.info("Migration completed successfully!")

    except Exception as e:
        logger.error(f"Migration failed: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    migrate()
