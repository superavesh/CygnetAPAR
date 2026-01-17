"""
Configuration settings for the InsertData Scheduler Service
"""
import os
from dataclasses import dataclass


@dataclass
class DatabaseConfig:
    """Database connection configuration"""
    host: str = os.getenv('MASTER_DB_HOST', 'localhost')
    port: int = int(os.getenv('MASTER_DB_PORT', '5432'))
    database: str = os.getenv('MASTER_DB_NAME', 'CygnetAPARMaster')
    user: str = os.getenv('PG_ADMIN_USER', 'postgres')
    password: str = os.getenv('PG_ADMIN_PASSWORD', 'Admin@123')


@dataclass
class SchedulerConfig:
    """Scheduler service configuration"""
    # Input directory for reading exported files
    input_base_dir: str = os.getenv('NFS_SHARED_DIR', r'D:\Avesh\APARChatBot\NFSShared')

    # Scheduler check interval in seconds
    check_interval: int = int(os.getenv('CHECK_INTERVAL', '60'))

    # Batch size for database inserts
    batch_size: int = int(os.getenv('BATCH_SIZE', '100'))

    # Archive processed files (move to archive folder)
    archive_processed: bool = os.getenv('ARCHIVE_PROCESSED', 'true').lower() == 'true'

    # Archive folder name
    archive_folder: str = os.getenv('ARCHIVE_FOLDER', '_processed')


# Global config instances
db_config = DatabaseConfig()
scheduler_config = SchedulerConfig()
