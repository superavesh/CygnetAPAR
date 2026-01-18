"""
Export Scheduler Service
Main service that runs scheduled export tasks for all subscribers
"""
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from croniter import croniter

from config import scheduler_config, db_config
from db_connection import (
    get_active_export_tasks,
    get_entities_for_subscriber,
    update_task_progress,
    log_task_execution,
    update_task_execution_log,
    ensure_transaction_logs_table,
    log_api_transaction
)
from api_client import ExportApiClient, save_export_data, MODULE_ENDPOINTS, ApiTransactionInfo

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('export_scheduler.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


class ExportScheduler:
    """Main scheduler service for export tasks"""

    def __init__(self):
        """Initialize the scheduler"""
        self.running = False
        logger.info("Export Scheduler Service initialized")
        logger.info(f"Master DB: {db_config.host}:{db_config.port}/{db_config.database}")
        logger.info(f"Output directory: {scheduler_config.output_base_dir}")

    def should_run_task(self, task: Dict[str, Any]) -> bool:
        """
        Check if a task should run based on cron expression and last run time

        Args:
            task: Task dictionary from database

        Returns:
            True if task should run, False otherwise
        """
        cron_expr = task.get('cron_expression')
        last_run = task.get('last_run_at')
        next_run = task.get('next_run_at')

        # If initial sync is not complete, always run
        if not task.get('is_initial_sync_complete'):
            return True

        # Check if it's time to run based on next_run_at
        if next_run:
            if datetime.now(next_run.tzinfo) >= next_run:
                return True
            return False

        # If no next_run set, calculate from cron
        if cron_expr:
            try:
                base_time = last_run if last_run else datetime.now()
                cron = croniter(cron_expr, base_time)
                next_run_time = cron.get_next(datetime)

                if datetime.now() >= next_run_time:
                    return True
            except Exception as e:
                logger.error(f"Error parsing cron expression '{cron_expr}': {e}")

        return False

    def _get_module_from_config(self, task_config: Dict[str, Any]) -> str:
        """
        Get the module to process from task config

        Args:
            task_config: Task configuration dictionary

        Returns:
            Module name to process (single module per scheduler)
        """
        if not task_config:
            return 'sale'  # Default to sale if no config

        # Support both 'module' (new single module format) and 'modules' (legacy list format)
        module = task_config.get('module')
        if module and module in MODULE_ENDPOINTS:
            return module

        # Legacy support: if 'modules' array exists, use first valid module
        modules = task_config.get('modules', [])
        if modules:
            valid_modules = [m for m in modules if m in MODULE_ENDPOINTS]
            if valid_modules:
                return valid_modules[0]

        return 'sale'  # Default fallback

    def _log_transactions(self, transactions: List[ApiTransactionInfo],
                          db_name: str, db_host: str, db_port: int,
                          db_user: str, db_password: str,
                          gstin: str, from_stamp: datetime, to_stamp: datetime,
                          file_path: str = None) -> None:
        """
        Log API transactions to tenant database

        Args:
            transactions: List of API transaction info objects
            db_name: Tenant database name
            db_host: Database host
            db_port: Database port
            db_user: Database user
            db_password: Database password
            gstin: GSTIN of the location
            from_stamp: Start datetime
            to_stamp: End datetime
            file_path: Path to saved response file
        """
        for trans in transactions:
            transaction_data = {
                'module': trans.module,
                'request_url': trans.request_url,
                'request_method': trans.request_method,
                'request_headers': trans.request_headers,
                'request_body': trans.request_body,
                'response_status_code': trans.response_status_code,
                'response_headers': trans.response_headers,
                'response_file_path': file_path,
                'gstin': gstin,
                'from_stamp': from_stamp,
                'to_stamp': to_stamp,
                'execution_time_ms': trans.execution_time_ms,
                'is_success': trans.is_success,
                'error_message': trans.error_message
            }

            try:
                log_api_transaction(db_name, db_host, db_port, db_user, db_password, transaction_data)
            except Exception as e:
                logger.error(f"Failed to log transaction: {e}")

    def process_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a single export task

        Args:
            task: Task dictionary from database

        Returns:
            Result dictionary with status and details
        """
        task_id = task['id']
        subscriber_id = task['subscriber_id']
        subscriber_name = task['subscriber_name']
        subscriber_url = task['subscriber_url']
        auth_token = task['subscriber_auth_token']

        # Database connection details
        db_name = task['database_name']
        db_host = task['db_host']
        db_port = task['db_port']
        db_user = task['db_user']
        db_password = task['db_password']

        # Time range settings
        start_datetime = task['start_datetime']
        last_from_stamp = task['last_from_stamp']
        last_to_stamp = task['last_to_stamp']
        is_initial_sync_complete = task['is_initial_sync_complete']

        # Get task config for modules
        task_config = task.get('task_config', {})
        if isinstance(task_config, str):
            import json
            try:
                task_config = json.loads(task_config)
            except:
                task_config = {}

        module = self._get_module_from_config(task_config)

        logger.info(f"Processing task {task_id} for subscriber {subscriber_name}")
        logger.info(f"Module to process: {module}")

        # Log execution start
        log_id = log_task_execution(task_id, subscriber_id, 'running')

        result = {
            'task_id': task_id,
            'subscriber_id': subscriber_id,
            'module': module,
            'files_created': [],
            'total_records': 0,
            'errors': []
        }

        try:
            # Ensure transaction_logs table exists in tenant database
            ensure_transaction_logs_table(db_name, db_host, db_port, db_user, db_password)

            # Determine time range for this run
            current_time = datetime.now()

            if not is_initial_sync_complete:
                # Initial sync: fetch from start_datetime to current time
                if start_datetime:
                    from_stamp = start_datetime.replace(tzinfo=None) if start_datetime.tzinfo else start_datetime
                else:
                    # Default to 30 days ago if no start_datetime specified
                    from_stamp = current_time - timedelta(days=30)
                to_stamp = current_time
                logger.info(f"Initial sync: fetching from {from_stamp} to {to_stamp}")
            else:
                # Incremental sync: fetch from last_to_stamp to current time
                if last_to_stamp:
                    from_stamp = last_to_stamp.replace(tzinfo=None) if last_to_stamp.tzinfo else last_to_stamp
                else:
                    from_stamp = current_time - timedelta(hours=1)
                to_stamp = current_time
                logger.info(f"Incremental sync: fetching from {from_stamp} to {to_stamp}")

            # Get all GSTINs from tenant database
            entities = get_entities_for_subscriber(
                db_name, db_host, db_port, db_user, db_password
            )

            if not entities:
                logger.warning(f"No entities found for subscriber {subscriber_id}")
                result['errors'].append("No entities found in tenant database")
            else:
                logger.info(f"Found {len(entities)} entities for subscriber {subscriber_id}")

                # Initialize API client
                api_client = ExportApiClient(subscriber_url, auth_token)

                # Process the configured module
                logger.info(f"Processing module: {module}")

                # Fetch data for each GSTIN
                for entity in entities:
                    gstin = entity['gstin']
                    if not gstin:
                        continue

                    try:
                        logger.info(f"Fetching {module} data for GSTIN: {gstin}")

                        # Fetch all records for this GSTIN and module
                        records, transactions = api_client.fetch_all_module_export(
                            module, gstin, from_stamp, to_stamp
                        )

                        file_path = None
                        if records:
                            # Save to file with module folder
                            file_path = save_export_data(
                                records, subscriber_name, gstin, from_stamp, to_stamp, module
                            )
                            result['files_created'].append(file_path)
                            result['total_records'] += len(records)
                            logger.info(f"Saved {len(records)} {module} records for GSTIN {gstin}")
                        else:
                            logger.info(f"No {module} records found for GSTIN {gstin}")

                        # Log API transactions to tenant database
                        self._log_transactions(
                            transactions, db_name, db_host, db_port, db_user, db_password,
                            gstin, from_stamp, to_stamp, file_path
                        )

                    except Exception as e:
                        error_msg = f"Error fetching {module} data for GSTIN {gstin}: {str(e)}"
                        logger.error(error_msg)
                        result['errors'].append(error_msg)

            # Update task progress
            # For initial sync, mark as complete after processing
            # For incremental, just update the timestamp
            is_now_complete = True if not is_initial_sync_complete else is_initial_sync_complete

            update_task_progress(
                task_id,
                from_stamp.isoformat(),
                to_stamp.isoformat(),
                is_now_complete
            )

            # Update execution log
            status = 'success' if not result['errors'] else 'failed'
            error_msg = '; '.join(result['errors']) if result['errors'] else None

            update_task_execution_log(
                log_id,
                status,
                error_msg,
                {
                    'module': result['module'],
                    'files_created': result['files_created'],
                    'total_records': result['total_records'],
                    'from_stamp': from_stamp.isoformat(),
                    'to_stamp': to_stamp.isoformat()
                }
            )

            logger.info(f"Task {task_id} completed: {result['total_records']} {module} records, {len(result['files_created'])} files")

        except Exception as e:
            error_msg = f"Task execution failed: {str(e)}"
            logger.error(error_msg)
            result['errors'].append(error_msg)

            update_task_execution_log(log_id, 'failed', error_msg)

        return result

    def run_once(self) -> List[Dict[str, Any]]:
        """
        Run scheduler once - check and process all due tasks

        Returns:
            List of results from processed tasks
        """
        logger.info("Checking for tasks to run...")

        try:
            tasks = get_active_export_tasks()
            logger.info(f"Found {len(tasks)} active export tasks")

            results = []
            for task in tasks:
                if self.should_run_task(task):
                    logger.info(f"Running task: {task['task_name']} (ID: {task['id']})")
                    result = self.process_task(task)
                    results.append(result)
                else:
                    logger.debug(f"Skipping task {task['id']} - not due yet")

            return results

        except Exception as e:
            logger.error(f"Error in scheduler run: {e}")
            return []

    def run(self):
        """
        Run the scheduler continuously

        This method runs in an infinite loop, checking for tasks at regular intervals
        """
        self.running = True
        logger.info(f"Starting Export Scheduler Service (check interval: {scheduler_config.check_interval}s)")

        while self.running:
            try:
                self.run_once()
            except Exception as e:
                logger.error(f"Error in scheduler loop: {e}")

            # Wait for next check interval
            logger.debug(f"Sleeping for {scheduler_config.check_interval} seconds...")
            time.sleep(scheduler_config.check_interval)

    def stop(self):
        """Stop the scheduler"""
        logger.info("Stopping Export Scheduler Service...")
        self.running = False


def main():
    """Main entry point"""
    import signal
    import sys

    scheduler = ExportScheduler()

    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}, shutting down...")
        scheduler.stop()
        sys.exit(0)

    # Handle shutdown signals
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    # Run the scheduler
    scheduler.run()


if __name__ == '__main__':
    main()
