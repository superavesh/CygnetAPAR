"""
API Client module for the Export Scheduler Service
Handles API calls to fetch export data
"""
import requests
import json
import os
import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from config import scheduler_config
import logging

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """Raised when an API call fails. Carries the transaction_info list so the
    caller can still log the failed request to the database."""
    def __init__(self, message: str, transactions: List['ApiTransactionInfo'] = None):
        super().__init__(message)
        self.transactions: List['ApiTransactionInfo'] = transactions or []


# Module configuration - defines API endpoints for different modules
MODULE_ENDPOINTS = {
    # Transaction modules
    'sale': '/enriched/v0.1/oregular/sale/export',
    'purchase': '/enriched/v0.1/oregular/purchase/export',
    'einvoice': '/enriched/v0.1/eInvoice/export',
    'ewaybill': '/enriched/v0.1/oregular/ewaybill/export',
    'creditnote': '/enriched/v0.1/oregular/creditnote/export',
    'debitnote': '/enriched/v0.1/oregular/debitnote/export',
    # GSTR modules
    '2b': '/enriched/v0.1/oregular/gstr2aReconciliation/export',
    'einv_generated': '/enriched/v0.1/oregular/purchase/exportEInvoiceGeneratedAgainstMe',
    'sales_auto_draft': '/enriched/v0.1/oregular/sales-auto-draft/export',
    # Reconciliation modules
    'recon_sales_autodraft': '/enriched/v0.1/oregular/recon/sales-autodraft/export',
    'recon_sales_einv': '/enriched/v0.1/oregular/recon/sales-einv/export',
    'recon_2b_pr': '/enriched/v0.1/oregular/recon/2b-pr/export',
    # Master data modules
    'customer_master': '/enriched/v0.1/oregular/master/customer/export',
    'location_master': '/enriched/v0.1/oregular/master/location/export',
    'user_master': '/enriched/v0.1/oregular/master/user/export',
    'vendor_master': '/enriched/v0.1/oregular/master/vendor/export',
}


@dataclass
class ApiTransactionInfo:
    """Data class to hold API transaction information for logging"""
    module: str
    request_url: str
    request_method: str
    request_headers: Dict[str, Any]
    request_body: Dict[str, Any]
    response_status_code: int
    response_headers: Dict[str, Any]
    execution_time_ms: int
    is_success: bool
    error_message: Optional[str] = None


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

    def _next_financial_year(self, fy: int) -> int:
        """
        Advance to the next financial year.
        e.g. 201617 → 201718,  202526 → 202627
        """
        fy_start = fy // 100          # e.g. 2016 from 201617
        next_start = fy_start + 1
        next_end = (next_start + 1) % 100   # e.g. 18 from 2018
        return next_start * 100 + next_end

    def _is_fy_invalid_error(self, response) -> bool:
        """Return True if the 422 response body contains a VAL0012 financial-year error."""
        try:
            body = response.json()
            errors = body if isinstance(body, list) else []
            return any(
                any(err.get('code') == 'VAL0012' for err in prop.get('errors', []))
                for prop in errors
            )
        except Exception:
            return False

    def fetch_module_export(self, module: str, gstin: str, from_stamp: datetime, to_stamp: datetime,
                             start: int = 0, size: int = 1000) -> Tuple[Dict[str, Any], List[ApiTransactionInfo]]:
        """
        Fetch export data from the API for any module.

        When the API returns a 422 VAL0012 (FinancialYear invalid) the method
        automatically advances the financial year by one and retries, repeating
        until a valid financial year is found or the current FY is exceeded.
        Every attempt — successful or failed — is recorded in the returned list
        so callers can log them all to the database.

        Returns:
            Tuple of (API response dict, list of ApiTransactionInfo for every attempt)
        """
        endpoint = MODULE_ENDPOINTS.get(module)
        if not endpoint:
            raise ValueError(f"Unknown module: {module}. Available modules: {list(MODULE_ENDPOINTS.keys())}")

        url = f"{self.base_url}{endpoint}"

        from_stamp_str = from_stamp.strftime(scheduler_config.api_date_format)
        to_stamp_str   = to_stamp.strftime(scheduler_config.api_date_format)
        headers_for_log = dict(self.headers)

        financial_year = self._get_financial_year(from_stamp)
        current_fy     = self._get_financial_year(datetime.now())

        all_attempts: List[ApiTransactionInfo] = []

        while financial_year <= current_fy:
            payload = {
                "locations": [{"locationGstin": gstin}],
                "start": start,
                "size": size,
                "financialYear": financial_year,
                "fromStamp": from_stamp_str,
                "toStamp": to_stamp_str,
            }

            logger.info(
                f"Fetching {module} export: GSTIN={gstin}, "
                f"from={from_stamp_str}, to={to_stamp_str}, FY={financial_year}"
            )

            request_start = time.time()
            transaction_info = None

            try:
                response = requests.post(url, headers=self.headers, json=payload, timeout=120)
                execution_time_ms = int((time.time() - request_start) * 1000)

                transaction_info = ApiTransactionInfo(
                    module=module,
                    request_url=url,
                    request_method='POST',
                    request_headers=headers_for_log,
                    request_body=payload,
                    response_status_code=response.status_code,
                    response_headers=dict(response.headers),
                    execution_time_ms=execution_time_ms,
                    is_success=response.ok,
                    error_message=None if response.ok else response.text[:500],
                )

                # 422 + VAL0012 → financial year is not valid for this module/GSTIN.
                # Advance to the next FY and retry with the same fromStamp/toStamp.
                if response.status_code == 422 and self._is_fy_invalid_error(response):
                    all_attempts.append(transaction_info)
                    next_fy = self._next_financial_year(financial_year)
                    logger.info(
                        f"FY {financial_year} invalid for {module}/{gstin} "
                        f"(VAL0012) — retrying with FY {next_fy}"
                    )
                    financial_year = next_fy
                    continue  # retry with next financial year

                response.raise_for_status()
                data = response.json()
                logger.info(f"API Response: {len(data.get('result', []))} records fetched")
                all_attempts.append(transaction_info)
                return data, all_attempts

            except ApiError:
                raise  # already wrapped, let it propagate

            except requests.exceptions.RequestException as e:
                execution_time_ms = int((time.time() - request_start) * 1000)
                error_msg = str(e)

                if transaction_info is None:
                    transaction_info = ApiTransactionInfo(
                        module=module,
                        request_url=url,
                        request_method='POST',
                        request_headers=headers_for_log,
                        request_body=payload,
                        response_status_code=getattr(e.response, 'status_code', 0) if hasattr(e, 'response') else 0,
                        response_headers=dict(getattr(e.response, 'headers', {})) if hasattr(e, 'response') and e.response else {},
                        execution_time_ms=execution_time_ms,
                        is_success=False,
                        error_message=error_msg[:500],
                    )

                all_attempts.append(transaction_info)
                logger.error(f"API request failed: {e}")
                raise ApiError(error_msg, transactions=all_attempts) from e

        # All financial years up to current_fy returned VAL0012 — nothing to fetch
        logger.warning(
            f"All financial years ({self._get_financial_year(from_stamp)}–{current_fy}) "
            f"returned VAL0012 for {module}/{gstin}. No data available."
        )
        raise ApiError(
            f"No valid financial year found for {module}/{gstin}",
            transactions=all_attempts,
        )

    def fetch_sale_export(self, gstin: str, from_stamp: datetime, to_stamp: datetime,
                          start: int = 0, size: int = 1000) -> Tuple[Dict[str, Any], List[ApiTransactionInfo]]:
        """
        Fetch sale export data from the API (backward compatible method)

        Args:
            gstin: GSTIN of the location
            from_stamp: Start datetime for data fetch
            to_stamp: End datetime for data fetch
            start: Pagination start index
            size: Number of records to fetch

        Returns:
            Tuple of (API response as dictionary, ApiTransactionInfo for logging)
        """
        return self.fetch_module_export('sale', gstin, from_stamp, to_stamp, start, size)

    def fetch_all_module_export(self, module: str, gstin: str, from_stamp: datetime,
                                 to_stamp: datetime) -> Tuple[List[Dict[str, Any]], List[ApiTransactionInfo]]:
        """
        Fetch all export data with pagination for any module.

        Pagination logic:
        - start: Starting record index (0-based)
        - size: Number of records to fetch per request (default 1000)
        - totalRecords: Total available records returned by API

        Example: If totalRecords = 1298
        - 1st call: start=0, size=1000 -> fetches records 0-999 (1000 records)
        - 2nd call: start=1000, size=1000 -> fetches records 1000-1297 (298 records)
        - Loop ends when all records are fetched

        Args:
            module: Module name (sale, purchase, einvoice, etc.)
            gstin: GSTIN of the location
            from_stamp: Start datetime for data fetch
            to_stamp: End datetime for data fetch

        Returns:
            Tuple of (List of all records, List of ApiTransactionInfo for all API calls)
        """
        all_records = []
        all_transactions = []
        start = 0
        size = scheduler_config.default_page_size
        total_records = None  # Will be set from first API response

        while True:
            logger.info(f"Fetching {module} records: start={start}, size={size}")
            try:
                response, page_transactions = self.fetch_module_export(module, gstin, from_stamp, to_stamp, start, size)
            except ApiError as e:
                # Collect all attempt transactions (including FY retries) then re-raise
                # so the caller can log every attempt to the database
                all_transactions.extend(e.transactions)
                raise ApiError(str(e), transactions=all_transactions) from e.__cause__

            all_transactions.extend(page_transactions)

            records = response.get('result', [])
            total_records = response.get('totalRecords', 0)

            # If no records returned, we're done
            if not records:
                logger.info(f"No more {module} records to fetch for GSTIN {gstin}")
                break

            all_records.extend(records)
            logger.info(f"Fetched {len(all_records)}/{total_records} {module} records for GSTIN {gstin}")

            # Check if we've fetched all records
            if len(all_records) >= total_records:
                logger.info(f"All {total_records} {module} records fetched for GSTIN {gstin}")
                break

            # Move to next page
            start += size

        return all_records, all_transactions

    def fetch_all_sale_export(self, gstin: str, from_stamp: datetime,
                               to_stamp: datetime) -> Tuple[List[Dict[str, Any]], List[ApiTransactionInfo]]:
        """
        Fetch all sale export data with pagination (backward compatible method)

        Args:
            gstin: GSTIN of the location
            from_stamp: Start datetime for data fetch
            to_stamp: End datetime for data fetch

        Returns:
            Tuple of (List of all records, List of ApiTransactionInfo for all API calls)
        """
        return self.fetch_all_module_export('sale', gstin, from_stamp, to_stamp)


def save_export_data(data: List[Dict[str, Any]], subscriber_name: str,
                     gstin: str, from_stamp: datetime, to_stamp: datetime,
                     module: str = 'sale') -> str:
    """
    Save export data to file

    Args:
        data: List of records to save
        subscriber_name: Name of the subscriber/client
        gstin: GSTIN of the location
        from_stamp: Start datetime
        to_stamp: End datetime
        module: Module name (sale, purchase, einvoice, etc.)

    Returns:
        Path to the saved file
    """
    # Create directory structure: base_dir/subscriber_name/module/YYYY/MM/DD/
    timestamp = datetime.now()
    dir_path = os.path.join(
        scheduler_config.output_base_dir,
        sanitize_filename(subscriber_name),
        module,  # Add module folder
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
            "module": module,
            "from_stamp": from_stamp.isoformat(),
            "to_stamp": to_stamp.isoformat(),
            "exported_at": timestamp.isoformat(),
            "total_records": len(data)
        },
        "data": data
    }

    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, indent=2, ensure_ascii=False, default=str)

    logger.info(f"Saved {len(data)} {module} records to {file_path}")
    return file_path


def sanitize_filename(name: str) -> str:
    """Sanitize a string to be safe for use as a filename/directory name"""
    # Replace invalid characters with underscore
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, '_')
    return name.strip()
