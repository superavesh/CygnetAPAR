"""
File processor module for reading and processing JSON export files
"""
import os
import json
import shutil
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from config import scheduler_config
import logging

logger = logging.getLogger(__name__)


def get_client_folders() -> List[str]:
    """Get list of client folders in the NFSShared directory"""
    base_dir = Path(scheduler_config.input_base_dir)

    if not base_dir.exists():
        logger.warning(f"Base directory does not exist: {base_dir}")
        return []

    client_folders = []
    for item in base_dir.iterdir():
        # Skip hidden folders, archive folders, and non-directories
        if item.is_dir() and not item.name.startswith('.') and not item.name.startswith('_'):
            client_folders.append(item.name)

    return client_folders


def find_json_files(client_name: str) -> List[Path]:
    """
    Find all JSON files for a client, organized by date folders.
    Structure: NFSShared/{ClientName}/{Year}/{Month}/{Day}/*.json
    """
    base_dir = Path(scheduler_config.input_base_dir) / client_name
    json_files = []

    if not base_dir.exists():
        return json_files

    # Walk through the directory structure
    for year_dir in base_dir.iterdir():
        if not year_dir.is_dir() or year_dir.name.startswith('_'):
            continue

        for month_dir in year_dir.iterdir():
            if not month_dir.is_dir() or month_dir.name.startswith('_'):
                continue

            for day_dir in month_dir.iterdir():
                if not day_dir.is_dir() or day_dir.name.startswith('_'):
                    continue

                # Find all JSON files in this day folder
                for json_file in day_dir.glob('*.json'):
                    json_files.append(json_file)

    # Sort by file modification time (oldest first)
    json_files.sort(key=lambda f: f.stat().st_mtime)

    return json_files


def read_json_file(file_path: Path) -> Optional[Dict[str, Any]]:
    """Read and parse a JSON export file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error in file {file_path}: {e}")
        return None
    except Exception as e:
        logger.error(f"Error reading file {file_path}: {e}")
        return None


def extract_metadata(data: Dict[str, Any]) -> Dict[str, Any]:
    """Extract metadata from the JSON file"""
    return data.get('metadata', {})


def extract_records(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract sales records from the JSON file"""
    return data.get('data', [])


def get_relative_file_path(file_path: Path) -> str:
    """Get the relative path from the base directory for storage"""
    base_dir = Path(scheduler_config.input_base_dir)
    try:
        return str(file_path.relative_to(base_dir))
    except ValueError:
        return str(file_path)


def archive_processed_file(file_path: Path) -> bool:
    """
    Move processed file to archive folder.
    Archive structure mirrors the original: _processed/{ClientName}/{Year}/{Month}/{Day}/
    """
    if not scheduler_config.archive_processed:
        return True

    try:
        base_dir = Path(scheduler_config.input_base_dir)
        relative_path = file_path.relative_to(base_dir)

        # Create archive path
        archive_base = base_dir / scheduler_config.archive_folder
        archive_path = archive_base / relative_path

        # Ensure archive directory exists
        archive_path.parent.mkdir(parents=True, exist_ok=True)

        # Move file to archive
        shutil.move(str(file_path), str(archive_path))
        logger.info(f"Archived file: {file_path} -> {archive_path}")

        return True
    except Exception as e:
        logger.error(f"Error archiving file {file_path}: {e}")
        return False


def process_client_files(client_name: str, processed_files: set) -> Tuple[List[Path], int]:
    """
    Get list of files to process for a client (excluding already processed files).
    Returns (files_to_process, skipped_count)
    """
    all_files = find_json_files(client_name)
    files_to_process = []
    skipped_count = 0

    for file_path in all_files:
        relative_path = get_relative_file_path(file_path)
        if relative_path in processed_files:
            skipped_count += 1
            continue
        files_to_process.append(file_path)

    return files_to_process, skipped_count


def validate_json_structure(data: Dict[str, Any]) -> Tuple[bool, str]:
    """Validate the JSON file has the expected structure"""
    if not isinstance(data, dict):
        return False, "Root element is not an object"

    if 'metadata' not in data:
        return False, "Missing 'metadata' field"

    if 'data' not in data:
        return False, "Missing 'data' field"

    metadata = data['metadata']
    if not isinstance(metadata, dict):
        return False, "'metadata' is not an object"

    required_metadata_fields = ['subscriber_name', 'gstin']
    for field in required_metadata_fields:
        if field not in metadata:
            return False, f"Missing required metadata field: {field}"

    records = data['data']
    if not isinstance(records, list):
        return False, "'data' is not an array"

    return True, "Valid"


def get_file_stats(file_path: Path) -> Dict[str, Any]:
    """Get file statistics for logging"""
    stat = file_path.stat()
    return {
        'size_bytes': stat.st_size,
        'size_kb': round(stat.st_size / 1024, 2),
        'size_mb': round(stat.st_size / (1024 * 1024), 2),
        'modified_at': datetime.fromtimestamp(stat.st_mtime).isoformat()
    }
