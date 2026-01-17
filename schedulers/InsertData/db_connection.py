"""
Database connection module for the InsertData Scheduler Service
"""
import psycopg2
from psycopg2.extras import RealDictCursor, execute_values
from contextlib import contextmanager
from typing import Generator, List, Dict, Any, Optional, Tuple
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


def get_subscriber_by_name(subscriber_name: str) -> Optional[Dict[str, Any]]:
    """Get subscriber details by name"""
    query = """
        SELECT
            s.subscriber_id,
            s.subscriber_name,
            s.subscriber_url,
            s.subscriber_auth_token,
            t.id as tenant_id,
            t.database_name,
            t.db_host,
            t.db_port,
            t.db_user,
            t.db_password
        FROM subscribers s
        JOIN tenants t ON s.subscriber_id = t.subscriber_id
        WHERE s.subscriber_name = %s
        AND s.is_active = true
        AND t.is_active = true
    """

    with get_master_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query, (subscriber_name,))
            result = cur.fetchone()
            return dict(result) if result else None


def get_all_active_subscribers() -> List[Dict[str, Any]]:
    """Get all active subscribers with their tenant info"""
    query = """
        SELECT
            s.subscriber_id,
            s.subscriber_name,
            s.subscriber_url,
            t.id as tenant_id,
            t.database_name,
            t.db_host,
            t.db_port,
            t.db_user,
            t.db_password
        FROM subscribers s
        JOIN tenants t ON s.subscriber_id = t.subscriber_id
        WHERE s.is_active = true
        AND t.is_active = true
        ORDER BY s.subscriber_name
    """

    with get_master_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query)
            results = cur.fetchall()
            return [dict(row) for row in results]


def ensure_sales_table_exists(conn) -> None:
    """Ensure the sales table exists in the tenant database"""
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        -- Location info
        location_gstin VARCHAR(20) NOT NULL,
        location_name VARCHAR(500),

        -- Document info
        irn VARCHAR(100),
        supply_type VARCHAR(10),
        purpose VARCHAR(50),
        is_pre_gst_regime VARCHAR(5),
        liability_discharge_return_period VARCHAR(20),
        document_type VARCHAR(20),
        transaction_type VARCHAR(50),
        transaction_nature VARCHAR(100),
        taxpayer_type VARCHAR(20),
        document_series_code VARCHAR(50),
        document_number VARCHAR(100) NOT NULL,
        document_date VARCHAR(20) NOT NULL,
        credit_note_reason VARCHAR(200),
        ref_document_remarks TEXT,
        ref_document_period_start_date VARCHAR(20),
        ref_document_period_end_date VARCHAR(20),
        ref_preceding_document_details JSONB,
        ref_contract_details JSONB,
        additional_supporting_document_details JSONB,

        -- Bill info
        bill_number VARCHAR(100),
        bill_date VARCHAR(20),
        port_code VARCHAR(20),
        document_currency_code VARCHAR(10),
        destination_country VARCHAR(100),
        pos INTEGER,
        document_value DECIMAL(18, 2),
        document_value_in_foreign_currency DECIMAL(18, 2),
        differential_percentage DECIMAL(10, 4),
        reverse_charge VARCHAR(5),
        claim_refund VARCHAR(5),
        under_igst_act VARCHAR(5),
        refund_eligibility VARCHAR(5),
        e_commerce_gstin VARCHAR(20),
        tds_gstin VARCHAR(20),

        -- Original document info
        original_document_number VARCHAR(100),
        original_document_date VARCHAR(20),
        original_return_period VARCHAR(20),

        -- Communication
        to_email_addresses TEXT,
        to_mobile_numbers TEXT,

        -- Return info
        return_period INTEGER,
        gst_action VARCHAR(50),
        push_errors TEXT,
        series_code VARCHAR(50),
        push_status VARCHAR(50),
        reconciliation_section VARCHAR(200),
        push_date VARCHAR(20),
        cancelled_date VARCHAR(20),

        -- Document charges
        document_discount DECIMAL(18, 2),
        document_other_charges DECIMAL(18, 2),
        is_amendment VARCHAR(5),

        -- Bill From info
        bill_from_gstin VARCHAR(20),
        bill_from_legal_name VARCHAR(500),
        bill_from_trade_name VARCHAR(500),
        bill_from_vendor_code VARCHAR(100),
        bill_from_address1 VARCHAR(500),
        bill_from_address2 VARCHAR(500),
        bill_from_city VARCHAR(100),
        bill_from_state_code INTEGER,
        bill_from_pincode INTEGER,
        bill_from_phone VARCHAR(50),
        bill_from_email VARCHAR(200),

        -- Dispatch From info
        dispatch_from_gstin VARCHAR(20),
        dispatch_from_trade_name VARCHAR(500),
        dispatch_from_vendor_code VARCHAR(100),
        dispatch_from_address1 VARCHAR(500),
        dispatch_from_address2 VARCHAR(500),
        dispatch_from_city VARCHAR(100),
        dispatch_from_state_code INTEGER,
        dispatch_from_pincode INTEGER,

        -- Bill To info
        bill_to_legal_name VARCHAR(500),
        bill_to_gstin VARCHAR(20),
        bill_to_trade_name VARCHAR(500),
        bill_to_vendor_code VARCHAR(100),
        bill_to_address1 VARCHAR(500),
        bill_to_address2 VARCHAR(500),
        bill_to_city VARCHAR(100),
        bill_to_state_code INTEGER,
        bill_to_pincode INTEGER,
        bill_to_phone VARCHAR(50),
        bill_to_email VARCHAR(200),

        -- Ship To info
        ship_to_gstin VARCHAR(20),
        ship_to_legal_name VARCHAR(500),
        ship_to_trade_name VARCHAR(500),
        ship_to_vendor_code VARCHAR(100),
        ship_to_address1 VARCHAR(500),
        ship_to_address2 VARCHAR(500),
        ship_to_city VARCHAR(100),
        ship_to_state_code INTEGER,
        ship_to_pincode INTEGER,

        -- Payment info
        payment_type VARCHAR(50),
        payment_mode VARCHAR(50),
        payment_amount DECIMAL(18, 2),
        advance_paid_amount DECIMAL(18, 2),
        payment_date VARCHAR(20),
        payment_remarks TEXT,
        payment_terms TEXT,
        payment_instruction TEXT,
        payee_name VARCHAR(200),
        payee_account_number VARCHAR(50),
        payment_amount_due DECIMAL(18, 2),
        ifsc VARCHAR(20),
        credit_transfer VARCHAR(100),
        direct_debit VARCHAR(100),
        credit_days INTEGER,
        upi_id VARCHAR(100),

        -- Other fields
        round_off_amount DECIMAL(18, 2),
        auto_draft_source VARCHAR(100),
        irn_generation_date VARCHAR(20),

        -- Custom fields
        custom1 TEXT,
        custom2 TEXT,
        custom3 TEXT,
        custom4 TEXT,
        custom5 TEXT,
        custom6 TEXT,
        custom7 TEXT,
        custom8 TEXT,
        custom9 TEXT,
        custom10 TEXT,
        custom11 TEXT,
        custom12 TEXT,
        custom13 TEXT,
        custom14 TEXT,
        custom15 TEXT,
        custom16 TEXT,
        custom17 TEXT,
        custom18 TEXT,
        custom19 TEXT,
        custom20 TEXT,

        -- GST sections
        gstr1_section TEXT,
        counter_part_action VARCHAR(100),
        counter_party_remarks TEXT,
        tax_determination_status VARCHAR(50),
        tax_determination_comparison TEXT,

        -- Items stored as JSONB
        items JSONB,

        -- Metadata
        source_file VARCHAR(500),
        imported_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

        -- Unique constraint for upsert
        CONSTRAINT sales_unique_document UNIQUE (document_number, document_date, location_gstin, location_name)
    );

    -- Create indexes for better query performance
    CREATE INDEX IF NOT EXISTS idx_sales_location_gstin ON sales(location_gstin);
    CREATE INDEX IF NOT EXISTS idx_sales_document_date ON sales(document_date);
    CREATE INDEX IF NOT EXISTS idx_sales_document_number ON sales(document_number);
    CREATE INDEX IF NOT EXISTS idx_sales_imported_at ON sales(imported_at);
    """

    with conn.cursor() as cur:
        cur.execute(create_table_sql)
        conn.commit()
        logger.info("Sales table ensured to exist")


def upsert_sales_records(conn, records: List[Dict[str, Any]], source_file: str) -> Tuple[int, int]:
    """
    Insert or update sales records into the tenant database.
    Returns (inserted_count, updated_count)
    """
    if not records:
        return 0, 0

    inserted_count = 0
    updated_count = 0

    # Define the columns to insert/update
    columns = [
        'location_gstin', 'location_name', 'irn', 'supply_type', 'purpose',
        'is_pre_gst_regime', 'liability_discharge_return_period', 'document_type',
        'transaction_type', 'transaction_nature', 'taxpayer_type', 'document_series_code',
        'document_number', 'document_date', 'credit_note_reason', 'ref_document_remarks',
        'ref_document_period_start_date', 'ref_document_period_end_date',
        'ref_preceding_document_details', 'ref_contract_details',
        'additional_supporting_document_details', 'bill_number', 'bill_date',
        'port_code', 'document_currency_code', 'destination_country', 'pos',
        'document_value', 'document_value_in_foreign_currency', 'differential_percentage',
        'reverse_charge', 'claim_refund', 'under_igst_act', 'refund_eligibility',
        'e_commerce_gstin', 'tds_gstin', 'original_document_number', 'original_document_date',
        'original_return_period', 'to_email_addresses', 'to_mobile_numbers',
        'return_period', 'gst_action', 'push_errors', 'series_code', 'push_status',
        'reconciliation_section', 'push_date', 'cancelled_date', 'document_discount',
        'document_other_charges', 'is_amendment', 'bill_from_gstin', 'bill_from_legal_name',
        'bill_from_trade_name', 'bill_from_vendor_code', 'bill_from_address1',
        'bill_from_address2', 'bill_from_city', 'bill_from_state_code', 'bill_from_pincode',
        'bill_from_phone', 'bill_from_email', 'dispatch_from_gstin', 'dispatch_from_trade_name',
        'dispatch_from_vendor_code', 'dispatch_from_address1', 'dispatch_from_address2',
        'dispatch_from_city', 'dispatch_from_state_code', 'dispatch_from_pincode',
        'bill_to_legal_name', 'bill_to_gstin', 'bill_to_trade_name', 'bill_to_vendor_code',
        'bill_to_address1', 'bill_to_address2', 'bill_to_city', 'bill_to_state_code',
        'bill_to_pincode', 'bill_to_phone', 'bill_to_email', 'ship_to_gstin',
        'ship_to_legal_name', 'ship_to_trade_name', 'ship_to_vendor_code', 'ship_to_address1',
        'ship_to_address2', 'ship_to_city', 'ship_to_state_code', 'ship_to_pincode',
        'payment_type', 'payment_mode', 'payment_amount', 'advance_paid_amount',
        'payment_date', 'payment_remarks', 'payment_terms', 'payment_instruction',
        'payee_name', 'payee_account_number', 'payment_amount_due', 'ifsc',
        'credit_transfer', 'direct_debit', 'credit_days', 'upi_id', 'round_off_amount',
        'auto_draft_source', 'irn_generation_date', 'custom1', 'custom2', 'custom3',
        'custom4', 'custom5', 'custom6', 'custom7', 'custom8', 'custom9', 'custom10',
        'custom11', 'custom12', 'custom13', 'custom14', 'custom15', 'custom16',
        'custom17', 'custom18', 'custom19', 'custom20', 'gstr1_section',
        'counter_part_action', 'counter_party_remarks', 'tax_determination_status',
        'tax_determination_comparison', 'items', 'source_file'
    ]

    # Build the upsert query
    columns_str = ', '.join(columns)
    placeholders = ', '.join(['%s'] * len(columns))

    # Build update clause for ON CONFLICT (exclude unique constraint columns)
    update_columns = [c for c in columns if c not in ['document_number', 'document_date', 'location_gstin', 'location_name']]
    update_clause = ', '.join([f"{c} = EXCLUDED.{c}" for c in update_columns])
    update_clause += ", updated_at = CURRENT_TIMESTAMP"

    upsert_sql = f"""
        INSERT INTO sales ({columns_str})
        VALUES ({placeholders})
        ON CONFLICT (document_number, document_date, location_gstin, location_name)
        DO UPDATE SET {update_clause}
        RETURNING (xmax = 0) as is_insert
    """

    with conn.cursor() as cur:
        for record in records:
            import json
            values = [
                record.get('locationGstin'),
                record.get('locationName'),
                record.get('irn'),
                record.get('supplyType'),
                record.get('purpose'),
                record.get('isPreGstRegime'),
                record.get('liabilityDischargeReturnPeriod'),
                record.get('documentType'),
                record.get('transactionType'),
                record.get('transactionNature'),
                record.get('taxpayerType'),
                record.get('documentSeriesCode'),
                record.get('documentNumber'),
                record.get('documentDate'),
                record.get('creditNoteReason'),
                record.get('refDocumentRemarks'),
                record.get('refDocumentPeriodStartDate'),
                record.get('refDocumentPeriodEndDate'),
                json.dumps(record.get('refPrecedingDocumentDetails')) if record.get('refPrecedingDocumentDetails') else None,
                json.dumps(record.get('refContractDetails')) if record.get('refContractDetails') else None,
                json.dumps(record.get('additionalSupportingDocumentDetails')) if record.get('additionalSupportingDocumentDetails') else None,
                record.get('billNumber'),
                record.get('billDate'),
                record.get('portCode'),
                record.get('documentCurrencyCode'),
                record.get('destinationCountry'),
                record.get('pos'),
                record.get('documentValue'),
                record.get('documentValueInForeignCurrency'),
                record.get('differentialPercentage'),
                record.get('reverseCharge'),
                record.get('claimRefund'),
                record.get('underIgstAct'),
                record.get('refundEligibility'),
                record.get('eCommerceGstin'),
                record.get('tdsGstin'),
                record.get('originalDocumentNumber'),
                record.get('originalDocumentDate'),
                record.get('originalReturnPeriod'),
                record.get('toEmailAddresses'),
                record.get('toMobileNumbers'),
                record.get('returnPeriod'),
                record.get('gstAction'),
                record.get('pushErrors'),
                record.get('seriesCode'),
                record.get('pushStatus'),
                record.get('reconciliationSection'),
                record.get('pushDate'),
                record.get('cancelledDate'),
                record.get('documentDiscount'),
                record.get('documentOtherCharges'),
                record.get('isAmendment'),
                record.get('billFromGstin'),
                record.get('billFromLegalName'),
                record.get('billFromTradeName'),
                record.get('billFromVendorCode'),
                record.get('billFromAddress1'),
                record.get('billFromAddress2'),
                record.get('billFromCity'),
                record.get('billFromStateCode'),
                record.get('billFromPincode'),
                record.get('billFromPhone'),
                record.get('billFromEmail'),
                record.get('dispatchFromGstin'),
                record.get('dispatchFromTradeName'),
                record.get('dispatchFromVendorCode'),
                record.get('dispatchFromAddress1'),
                record.get('dispatchFromAddress2'),
                record.get('dispatchFromCity'),
                record.get('dispatchFromStateCode'),
                record.get('dispatchFromPincode'),
                record.get('billToLegalName'),
                record.get('billToGstin'),
                record.get('billToTradeName'),
                record.get('billToVendorCode'),
                record.get('billToAddress1'),
                record.get('billToAddress2'),
                record.get('billToCity'),
                record.get('billToStateCode'),
                record.get('billToPincode'),
                record.get('billToPhone'),
                record.get('billToEmail'),
                record.get('shipToGstin'),
                record.get('shipToLegalName'),
                record.get('shipToTradeName'),
                record.get('shipToVendorCode'),
                record.get('shipToAddress1'),
                record.get('shipToAddress2'),
                record.get('shipToCity'),
                record.get('shipToStateCode'),
                record.get('shipToPincode'),
                record.get('paymentType'),
                record.get('paymentMode'),
                record.get('paymentAmount'),
                record.get('advancePaidAmount'),
                record.get('paymentDate'),
                record.get('paymentRemarks'),
                record.get('paymentTerms'),
                record.get('paymentInstruction'),
                record.get('payeeName'),
                record.get('payeeAccountNumber'),
                record.get('paymentAmountDue'),
                record.get('ifsc'),
                record.get('creditTransfer'),
                record.get('directDebit'),
                record.get('creditDays'),
                record.get('upiId'),
                record.get('roundOffAmount'),
                record.get('autoDraftSource'),
                record.get('irnGenerationDate'),
                record.get('custom1'),
                record.get('custom2'),
                record.get('custom3'),
                record.get('custom4'),
                record.get('custom5'),
                record.get('custom6'),
                record.get('custom7'),
                record.get('custom8'),
                record.get('custom9'),
                record.get('custom10'),
                record.get('custom11'),
                record.get('custom12'),
                record.get('custom13'),
                record.get('custom14'),
                record.get('custom15'),
                record.get('custom16'),
                record.get('custom17'),
                record.get('custom18'),
                record.get('custom19'),
                record.get('custom20'),
                record.get('gstr1Section'),
                record.get('counterPartAction'),
                record.get('counterPartyRemarks'),
                record.get('taxDeterminationStatus'),
                record.get('taxDeterminationComparison'),
                json.dumps(record.get('items')) if record.get('items') else None,
                source_file
            ]

            try:
                cur.execute(upsert_sql, values)
                result = cur.fetchone()
                if result and result[0]:  # is_insert is True
                    inserted_count += 1
                else:
                    updated_count += 1
            except Exception as e:
                logger.error(f"Error upserting record {record.get('documentNumber')}: {e}")
                raise

        conn.commit()

    return inserted_count, updated_count


def get_processed_files(conn) -> set:
    """Get list of already processed files from the tenant database"""
    query = "SELECT DISTINCT source_file FROM sales WHERE source_file IS NOT NULL"

    try:
        with conn.cursor() as cur:
            cur.execute(query)
            results = cur.fetchall()
            return {row[0] for row in results}
    except Exception as e:
        logger.warning(f"Could not get processed files: {e}")
        return set()
