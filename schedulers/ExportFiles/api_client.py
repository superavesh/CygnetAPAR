"""
API Client module for the Export Scheduler Service
Handles API calls to fetch export data
"""
import requests
import json
import os
from datetime import datetime
from typing import Dict, Any, List, Optional
from config import scheduler_config
import logging

logger = logging.getLogger(__name__)


class ExportApiClient:
    """Client for making export API calls"""

    def __init__(self, base_url: str, auth_token: str):
        """
        Initialize the API client

        Args:
            base_url: The subscriber's base URL
            auth_token: Authentication token for API calls
        """
        self.base_url = base_url.rstrip('/')
        self.auth_token = auth_token
        self.headers = {
            'accept': 'application/json',
            'auth-token': auth_token,
            'Content-Type': 'application/json'
        }

    def _get_financial_year(self, date: datetime) -> int:
        """
        Calculate financial year from a date
        Financial year runs from April 1 to March 31
        e.g., April 2024 to March 2025 = 202425
        """
        year = date.year
        month = date.month

        if month >= 4:  # April onwards
            fy_start = year
            fy_end = year + 1
        else:  # January to March
            fy_start = year - 1
            fy_end = year

        return int(f"{fy_start}{str(fy_end)[-2:]}")

    def fetch_sale_export(self, gstin: str, from_stamp: datetime, to_stamp: datetime,
                          start: int = 0, size: int = 1000) -> Dict[str, Any]:
        """
        Fetch sale export data from the API

        Args:
            gstin: GSTIN of the location
            from_stamp: Start datetime for data fetch
            to_stamp: End datetime for data fetch
            start: Pagination start index
            size: Number of records to fetch

        Returns:
            API response as dictionary
        """
        url = f"{self.base_url}/enriched/v0.1/oregular/sale/export"

        # Format dates for API
        from_stamp_str = from_stamp.strftime(scheduler_config.api_date_format)
        to_stamp_str = to_stamp.strftime(scheduler_config.api_date_format)

        # Calculate financial year from the from_stamp
        financial_year = self._get_financial_year(from_stamp)

        payload = {
            "locations": [
                {"locationGstin": gstin}
            ],
            "start": start,
            "size": size,
            "financialYear": financial_year,
            "fromStamp": from_stamp_str,
            "toStamp": to_stamp_str
        }

        logger.info(f"Fetching sale export: GSTIN={gstin}, from={from_stamp_str}, to={to_stamp_str}, FY={financial_year}")

        try:
            response = requests.post(url, headers=self.headers, json=payload, timeout=120)
            response.raise_for_status()

            data = response.json()
            logger.info(f"API Response: {len(data.get('result', []))} records fetched")
            return data

        except requests.exceptions.RequestException as e:
            logger.error(f"API request failed: {e}")
            raise

    def fetch_all_sale_export(self, gstin: str, from_stamp: datetime,
                               to_stamp: datetime) -> List[Dict[str, Any]]:
        """
        Fetch all sale export data with pagination

        Args:
            gstin: GSTIN of the location
            from_stamp: Start datetime for data fetch
            to_stamp: End datetime for data fetch

        Returns:
            List of all records
        """
        all_records = []
        start = 0
        size = scheduler_config.default_page_size
        has_more = True

        while has_more:
            response = self.fetch_sale_export(gstin, from_stamp, to_stamp, start, size)

            records = response.get('result', [])
            total_records = response.get('totalRecords', 0)

            if not records:
                has_more = False
                break

            all_records.extend(records)
            logger.info(f"Fetched {len(all_records)}/{total_records} records for GSTIN {gstin}")

            if len(all_records) >= total_records or len(records) < size:
                has_more = False
            else:
                start += size

        return all_records


def save_export_data(data: List[Dict[str, Any]], subscriber_name: str,
                     gstin: str, from_stamp: datetime, to_stamp: datetime) -> str:
    """
    Save export data to file

    Args:
        data: List of records to save
        subscriber_name: Name of the subscriber/client
        gstin: GSTIN of the location
        from_stamp: Start datetime
        to_stamp: End datetime

    Returns:
        Path to the saved file
    """
    # Create directory structure: base_dir/subscriber_name/YYYY/MM/DD/
    timestamp = datetime.now()
    dir_path = os.path.join(
        scheduler_config.output_base_dir,
        sanitize_filename(subscriber_name),
        str(timestamp.year),
        str(timestamp.month).zfill(2),
        str(timestamp.day).zfill(2)
    )

    os.makedirs(dir_path, exist_ok=True)

    # Create filename: gstin_fromstamp_tostamp_timestamp.json
    from_str = from_stamp.strftime('%Y%m%d_%H%M%S')
    to_str = to_stamp.strftime('%Y%m%d_%H%M%S')
    file_timestamp = timestamp.strftime(scheduler_config.file_timestamp_format)

    filename = f"{gstin}_{from_str}_to_{to_str}_{file_timestamp}.json"
    file_path = os.path.join(dir_path, filename)

    # Save data
    export_data = {
        "metadata": {
            "subscriber_name": subscriber_name,
            "gstin": gstin,
            "from_stamp": from_stamp.isoformat(),
            "to_stamp": to_stamp.isoformat(),
            "exported_at": timestamp.isoformat(),
            "total_records": len(data)
        },
        "data": data
    }

    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, indent=2, ensure_ascii=False, default=str)

    logger.info(f"Saved {len(data)} records to {file_path}")
    return file_path


def sanitize_filename(name: str) -> str:
    """Sanitize a string to be safe for use as a filename/directory name"""
    # Replace invalid characters with underscore
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, '_')
    return name.strip()
