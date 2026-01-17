"""
Configuration settings for the Export Scheduler Service
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
    # Output directory for exported files
    output_base_dir: str = os.getenv('EXPORT_OUTPUT_DIR', r'D:\Avesh\APARChatBot\NFSShared')

    # API settings
    default_page_size: int = 1000

    # Scheduler check interval in seconds
    check_interval: int = 60

    # Date format for API calls
    api_date_format: str = '%d-%m-%Y %H:%M:%S'

    # File timestamp format
    file_timestamp_format: str = '%Y%m%d_%H%M%S'


# Global config instances
db_config = DatabaseConfig()
scheduler_config = SchedulerConfig()
