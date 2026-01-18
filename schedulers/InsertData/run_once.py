"""
Run a single processing cycle without continuous loop.
Useful for testing or one-time data import.

Usage:
    python run_once.py                  # Normal run (skip already processed files)
    python run_once.py --recreate       # Drop and recreate sales table, then process all files
    python run_once.py --force          # Process all files (ignore already processed)
"""
import sys
import argparse
import logging
from datetime import datetime

from config import scheduler_config, db_config
from db_connection import (
    get_subscriber_by_name,
    get_tenant_connection,
    ensure_sales_table_exists,
    drop_sales_table,
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
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


def process_file(file_path, conn):
    """Process a single JSON file"""
    try:
        file_stats = get_file_stats(file_path)
        logger.info(f"Processing file: {file_path.name} ({file_stats['size_mb']} MB)")

        data = read_json_file(file_path)
        if data is None:
            return {'success': False, 'error': "Failed to read JSON file"}

        is_valid, validation_msg = validate_json_structure(data)
        if not is_valid:
            return {'success': False, 'error': f"Invalid file structure: {validation_msg}"}

        metadata = extract_metadata(data)
        records = extract_records(data)

        logger.info(f"  Subscriber: {metadata.get('subscriber_name')}, "
                   f"GSTIN: {metadata.get('gstin')}, Records: {len(records)}")

        if not records:
            return {'success': True, 'inserted': 0, 'updated': 0}

        relative_path = get_relative_file_path(file_path)
        inserted, updated = upsert_sales_records(conn, records, relative_path)

        logger.info(f"  Result: {inserted} inserted, {updated} updated")

        if scheduler_config.archive_processed:
            archive_processed_file(file_path)

        return {'success': True, 'inserted': inserted, 'updated': updated}

    except Exception as e:
        logger.error(f"Error processing file {file_path}: {e}", exc_info=True)
        return {'success': False, 'error': str(e)}


def main():
    """Run a single processing cycle"""
    parser = argparse.ArgumentParser(description='InsertData - Single Run')
    parser.add_argument('--recreate', action='store_true',
                        help='Drop and recreate the sales table before processing')
    parser.add_argument('--force', action='store_true',
                        help='Process all files (ignore already processed)')
    args = parser.parse_args()

    logger.info("=" * 70)
    logger.info("InsertData - Single Run")
    logger.info("=" * 70)
    logger.info(f"Input directory: {scheduler_config.input_base_dir}")
    logger.info(f"Master DB: {db_config.host}:{db_config.port}/{db_config.database}")
    if args.recreate:
        logger.info("Mode: RECREATE (will drop and recreate sales table)")
    elif args.force:
        logger.info("Mode: FORCE (will process all files)")
    else:
        logger.info("Mode: NORMAL (will skip already processed files)")
    logger.info("=" * 70)

    client_folders = get_client_folders()

    if not client_folders:
        logger.info("No client folders found")
        return

    logger.info(f"Found {len(client_folders)} client folders: {client_folders}")

    total_inserted = 0
    total_updated = 0
    total_files = 0

    for client_name in client_folders:
        logger.info(f"\n{'=' * 50}")
        logger.info(f"Processing client: {client_name}")
        logger.info(f"{'=' * 50}")

        subscriber_info = get_subscriber_by_name(client_name)

        if not subscriber_info:
            logger.warning(f"No subscriber found for: {client_name}")
            continue

        logger.info(f"Database: {subscriber_info['database_name']}")

        try:
            with get_tenant_connection(
                subscriber_info['database_name'],
                subscriber_info['db_host'],
                subscriber_info['db_port'],
                subscriber_info['db_user'],
                subscriber_info['db_password']
            ) as conn:
                # Drop and recreate table if requested
                if args.recreate:
                    logger.info("Dropping existing sales table...")
                    drop_sales_table(conn)

                ensure_sales_table_exists(conn)

                # Get files to process
                if args.recreate or args.force:
                    # Process all files
                    files_to_process = find_json_files(client_name)
                    skipped = 0
                    logger.info(f"Files to process: {len(files_to_process)} (processing all files)")
                else:
                    # Skip already processed files
                    processed_files = get_processed_files(conn)
                    files_to_process, skipped = process_client_files(client_name, processed_files)
                    logger.info(f"Files to process: {len(files_to_process)}, Skipped (already processed): {skipped}")

                for file_path in files_to_process:
                    result = process_file(file_path, conn)
                    if result['success']:
                        total_files += 1
                        total_inserted += result.get('inserted', 0)
                        total_updated += result.get('updated', 0)

        except Exception as e:
            logger.error(f"Error processing client {client_name}: {e}", exc_info=True)

    logger.info(f"\n{'=' * 70}")
    logger.info("SUMMARY")
    logger.info(f"{'=' * 70}")
    logger.info(f"Total files processed: {total_files}")
    logger.info(f"Total records inserted: {total_inserted}")
    logger.info(f"Total records updated: {total_updated}")
    logger.info(f"{'=' * 70}")


if __name__ == '__main__':
    main()
