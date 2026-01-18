"""
Main scheduler service for processing JSON files and inserting data into tenant databases
"""
import time
import signal
import sys
from datetime import datetime
from typing import Dict, Any, List
import logging

from config import scheduler_config, db_config
from db_connection import (
    get_subscriber_by_name,
    get_all_active_subscribers,
    get_tenant_connection,
    ensure_sales_table_exists,
    upsert_sales_records,
    get_processed_files
)
from file_processor import (
    get_client_folders,
    find_json_files,
    read_json_file,
    extract_metadata,
    extract_records,
    get_relative_file_path,
    archive_processed_file,
    process_client_files,
    validate_json_structure,
    get_file_stats
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('insert_data_scheduler.log')
    ]
)
logger = logging.getLogger(__name__)

# Global flag for graceful shutdown
shutdown_flag = False


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    global shutdown_flag
    logger.info(f"Received signal {signum}. Initiating graceful shutdown...")
    shutdown_flag = True


def process_file(file_path, subscriber_info: Dict[str, Any], conn) -> Dict[str, Any]:
    """
    Process a single JSON file and insert data into tenant database.
    Returns processing result dictionary.
    """
    result = {
        'file': str(file_path),
        'success': False,
        'records_processed': 0,
        'inserted': 0,
        'updated': 0,
        'error': None
    }

    try:
        # Get file stats
        file_stats = get_file_stats(file_path)
        logger.info(f"Processing file: {file_path.name} ({file_stats['size_mb']} MB)")

        # Read JSON file
        data = read_json_file(file_path)
        if data is None:
            result['error'] = "Failed to read JSON file"
            return result

        # Validate structure
        is_valid, validation_msg = validate_json_structure(data)
        if not is_valid:
            result['error'] = f"Invalid file structure: {validation_msg}"
            return result

        # Extract metadata and records
        metadata = extract_metadata(data)
        records = extract_records(data)

        logger.info(f"File metadata - Subscriber: {metadata.get('subscriber_name')}, "
                   f"GSTIN: {metadata.get('gstin')}, Records: {len(records)}")

        if not records:
            logger.info(f"No records to process in file: {file_path.name}")
            result['success'] = True
            return result

        # Get relative path for source_file tracking
        relative_path = get_relative_file_path(file_path)

        # Upsert records
        inserted, updated = upsert_sales_records(conn, records, relative_path)

        result['success'] = True
        result['records_processed'] = len(records)
        result['inserted'] = inserted
        result['updated'] = updated

        logger.info(f"Processed {file_path.name}: {inserted} inserted, {updated} updated")

        # Archive the file after successful processing
        if scheduler_config.archive_processed:
            archive_processed_file(file_path)

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"Error processing file {file_path}: {e}", exc_info=True)

    return result


def process_client(client_name: str) -> Dict[str, Any]:
    """
    Process all pending files for a client.
    Returns summary of processing.
    """
    summary = {
        'client_name': client_name,
        'success': False,
        'files_processed': 0,
        'files_skipped': 0,
        'total_inserted': 0,
        'total_updated': 0,
        'errors': []
    }

    try:
        # Get subscriber info from database
        subscriber_info = get_subscriber_by_name(client_name)

        if not subscriber_info:
            summary['errors'].append(f"No active subscriber found for client: {client_name}")
            logger.warning(f"Skipping client {client_name}: No matching subscriber in database")
            return summary

        logger.info(f"Processing client: {client_name} -> Database: {subscriber_info['database_name']}")

        # Connect to tenant database
        with get_tenant_connection(
            subscriber_info['database_name'],
            subscriber_info['db_host'],
            subscriber_info['db_port'],
            subscriber_info['db_user'],
            subscriber_info['db_password']
        ) as conn:
            # Ensure sales table exists
            ensure_sales_table_exists(conn)

            # Get list of already processed files
            processed_files = get_processed_files(conn)
            logger.info(f"Found {len(processed_files)} previously processed files")

            # Get files to process
            files_to_process, skipped_count = process_client_files(client_name, processed_files)
            summary['files_skipped'] = skipped_count

            if not files_to_process:
                logger.info(f"No new files to process for client: {client_name}")
                summary['success'] = True
                return summary

            logger.info(f"Found {len(files_to_process)} new files to process for {client_name}")

            # Process each file
            for file_path in files_to_process:
                if shutdown_flag:
                    logger.info("Shutdown requested, stopping file processing")
                    break

                result = process_file(file_path, subscriber_info, conn)

                if result['success']:
                    summary['files_processed'] += 1
                    summary['total_inserted'] += result['inserted']
                    summary['total_updated'] += result['updated']
                else:
                    summary['errors'].append({
                        'file': result['file'],
                        'error': result['error']
                    })

        summary['success'] = len(summary['errors']) == 0

    except Exception as e:
        summary['errors'].append(f"Client processing error: {str(e)}")
        logger.error(f"Error processing client {client_name}: {e}", exc_info=True)

    return summary


def run_processing_cycle() -> Dict[str, Any]:
    """
    Run a single processing cycle for all clients.
    Returns cycle summary.
    """
    cycle_summary = {
        'started_at': datetime.now().isoformat(),
        'completed_at': None,
        'clients_processed': 0,
        'total_files': 0,
        'total_inserted': 0,
        'total_updated': 0,
        'client_summaries': []
    }

    try:
        # Get all client folders
        client_folders = get_client_folders()

        if not client_folders:
            logger.info("No client folders found in NFSShared directory")
            cycle_summary['completed_at'] = datetime.now().isoformat()
            return cycle_summary

        logger.info(f"Found {len(client_folders)} client folders: {client_folders}")

        # Process each client
        for client_name in client_folders:
            if shutdown_flag:
                logger.info("Shutdown requested, stopping cycle")
                break

            logger.info(f"=" * 50)
            logger.info(f"Processing client: {client_name}")
            logger.info(f"=" * 50)

            client_summary = process_client(client_name)
            cycle_summary['client_summaries'].append(client_summary)

            if client_summary['success'] or client_summary['files_processed'] > 0:
                cycle_summary['clients_processed'] += 1
                cycle_summary['total_files'] += client_summary['files_processed']
                cycle_summary['total_inserted'] += client_summary['total_inserted']
                cycle_summary['total_updated'] += client_summary['total_updated']

    except Exception as e:
        logger.error(f"Error in processing cycle: {e}", exc_info=True)

    cycle_summary['completed_at'] = datetime.now().isoformat()
    return cycle_summary


def main():
    """Main entry point for the scheduler service"""
    global shutdown_flag

    # Register signal handlers for graceful shutdown
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    logger.info("=" * 70)
    logger.info("InsertData Scheduler Service Starting")
    logger.info("=" * 70)
    logger.info(f"Configuration:")
    logger.info(f"  - Input directory: {scheduler_config.input_base_dir}")
    logger.info(f"  - Check interval: {scheduler_config.check_interval} seconds")
    logger.info(f"  - Archive processed: {scheduler_config.archive_processed}")
    logger.info(f"  - Master DB: {db_config.host}:{db_config.port}/{db_config.database}")
    logger.info("=" * 70)

    cycle_count = 0

    while not shutdown_flag:
        cycle_count += 1
        logger.info(f"\n{'#' * 70}")
        logger.info(f"Starting processing cycle #{cycle_count}")
        logger.info(f"{'#' * 70}\n")

        try:
            cycle_summary = run_processing_cycle()

            # Log cycle summary
            logger.info(f"\n{'=' * 50}")
            logger.info(f"Cycle #{cycle_count} Summary:")
            logger.info(f"  - Clients processed: {cycle_summary['clients_processed']}")
            logger.info(f"  - Files processed: {cycle_summary['total_files']}")
            logger.info(f"  - Records inserted: {cycle_summary['total_inserted']}")
            logger.info(f"  - Records updated: {cycle_summary['total_updated']}")
            logger.info(f"  - Duration: {cycle_summary['started_at']} to {cycle_summary['completed_at']}")
            logger.info(f"{'=' * 50}\n")

            # Log any errors
            for client_summary in cycle_summary['client_summaries']:
                if client_summary['errors']:
                    logger.warning(f"Errors for {client_summary['client_name']}:")
                    for error in client_summary['errors']:
                        logger.warning(f"  - {error}")

        except Exception as e:
            logger.error(f"Error in processing cycle: {e}", exc_info=True)

        if not shutdown_flag:
            logger.info(f"Sleeping for {scheduler_config.check_interval} seconds before next cycle...")
            for _ in range(scheduler_config.check_interval):
                if shutdown_flag:
                    break
                time.sleep(1)

    logger.info("InsertData Scheduler Service stopped gracefully")


if __name__ == '__main__':
    main()
