"""
Database connection module for the InsertData Scheduler Service
"""
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Generator, List, Dict, Any, Optional, Tuple
from config import db_config
import logging
import json

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
        WHERE t.is_active = true
        ORDER BY s.subscriber_name
    """

    with get_master_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(query)
            results = cur.fetchall()
            return [dict(row) for row in results]


def drop_sales_table(conn) -> None:
    """Drop the sales table if it exists"""
    with conn.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS sales CASCADE")
        conn.commit()
        logger.info("Sales table dropped")


def ensure_sales_table_exists(conn) -> None:
    """Ensure the sales table exists in the tenant database with correct schema"""
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,

        -- Location info
        location_gstin VARCHAR(20) NOT NULL,
        location_name VARCHAR(500),

        -- Return info
        return_period INTEGER,
        liability_discharge_return_period VARCHAR(50),
        purpose VARCHAR(50),
        auto_push_or_generate VARCHAR(50),
        supply_type VARCHAR(10),
        irn VARCHAR(100),

        -- Document info
        document_type VARCHAR(20),
        transaction_type VARCHAR(50),
        taxpayer_type VARCHAR(20),
        transaction_nature VARCHAR(100),
        document_number VARCHAR(100) NOT NULL,
        document_date VARCHAR(20) NOT NULL,

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
        bill_to_gstin VARCHAR(20),
        bill_to_legal_name VARCHAR(500),
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

        -- Reference document info
        ref_document_remarks TEXT,
        ref_document_period_start_date VARCHAR(20),
        ref_document_period_end_date VARCHAR(20),
        ref_preceding_document_details TEXT,
        ref_contract_details TEXT,
        additional_supporting_document_details TEXT,

        -- Bill info
        bill_number VARCHAR(100),
        bill_date VARCHAR(20),
        port_code VARCHAR(20),
        document_currency_code VARCHAR(10),
        destination_country VARCHAR(100),
        pos INTEGER,
        document_value DECIMAL(18, 2),
        document_discount DECIMAL(18, 2),
        document_other_charges DECIMAL(18, 2),
        document_value_in_foreign_currency DECIMAL(18, 2),
        round_off_amount DECIMAL(18, 2),
        differential_percentage DECIMAL(10, 4),
        reverse_charge VARCHAR(5),
        claim_refund VARCHAR(5),
        under_igst_act VARCHAR(5),
        refund_eligibility VARCHAR(5),
        e_commerce_gstin VARCHAR(20),
        tds_gstin VARCHAR(20),

        -- Original document info
        original_gstin VARCHAR(20),
        original_state_code INTEGER,
        original_document_number VARCHAR(100),
        original_document_date VARCHAR(20),
        original_return_period VARCHAR(20),
        original_taxable_value DECIMAL(18, 2),

        -- Communication
        to_email_addresses TEXT,
        to_mobile_numbers TEXT,

        -- JW (Job Work) fields
        jw_original_document_number VARCHAR(100),
        jw_original_document_date VARCHAR(20),
        jw_document_number VARCHAR(100),
        jw_document_date VARCHAR(20),

        -- Custom fields (document level)
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

        -- Item fields
        serial_number INTEGER,
        is_service VARCHAR(5),
        hsn VARCHAR(20),
        product_code VARCHAR(100),
        item_name VARCHAR(500),
        item_description TEXT,
        nature_of_jw_done VARCHAR(200),
        barcode VARCHAR(100),
        uqc VARCHAR(20),
        quantity DECIMAL(18, 6),
        free_quantity DECIMAL(18, 6),
        loss_unit_of_measure VARCHAR(50),
        loss_total_quantity DECIMAL(18, 6),
        rate DECIMAL(18, 4),
        cess_rate DECIMAL(18, 4),
        state_cess_rate DECIMAL(18, 4),
        cess_non_advalorem_rate DECIMAL(18, 4),
        price_per_quantity DECIMAL(18, 4),
        discount_amount DECIMAL(18, 2),
        gross_amount DECIMAL(18, 2),
        other_charges DECIMAL(18, 2),
        taxable_value DECIMAL(18, 2),
        igst_amount DECIMAL(18, 2),
        cgst_amount DECIMAL(18, 2),
        sgst_amount DECIMAL(18, 2),
        cess_amount DECIMAL(18, 2),
        state_cess_amount DECIMAL(18, 2),
        state_cess_non_advalorem_amount DECIMAL(18, 2),
        cess_non_advalorem_amount DECIMAL(18, 2),
        tax_type VARCHAR(50),

        -- Custom item fields
        custom_item1 TEXT,
        custom_item2 TEXT,
        custom_item3 TEXT,
        custom_item4 TEXT,
        custom_item5 TEXT,
        custom_item6 TEXT,
        custom_item7 TEXT,
        custom_item8 TEXT,
        custom_item9 TEXT,
        custom_item10 TEXT,

        -- Transaction info
        transaction_id VARCHAR(100),
        transaction_note TEXT,
        push_errors TEXT,
        ogst_push_status VARCHAR(50),
        gst_action VARCHAR(50),
        reconciliation_section VARCHAR(200),
        push_date VARCHAR(50),
        is_pre_gst_regime VARCHAR(5),
        filing_status VARCHAR(50),
        irn_generation_date VARCHAR(50),
        auto_draft_source VARCHAR(100),
        is_amendment VARCHAR(5),
        upi_id VARCHAR(100),
        gst_act_or_rule_section VARCHAR(200),
        reference_id VARCHAR(100),
        uploaded_or_downloaded_datetime VARCHAR(50),
        payment_due_date VARCHAR(20),
        gstr3b_section TEXT,
        cancelled_date VARCHAR(50),
        gstr1_section TEXT,
        inter_intra VARCHAR(20),

        -- Custom fields (11-20)
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

        -- Custom item fields (11-20)
        custom_item11 TEXT,
        custom_item12 TEXT,
        custom_item13 TEXT,
        custom_item14 TEXT,
        custom_item15 TEXT,
        custom_item16 TEXT,
        custom_item17 TEXT,
        custom_item18 TEXT,
        custom_item19 TEXT,
        custom_item20 TEXT,

        -- Additional fields
        return_type VARCHAR(50),
        counter_party_action VARCHAR(100),
        credit_note_reason VARCHAR(200),
        counter_party_remarks TEXT,
        determined_rate DECIMAL(18, 4),
        determined_taxable DECIMAL(18, 2),
        determined_igst DECIMAL(18, 2),
        determined_cgst DECIMAL(18, 2),
        determined_sgst DECIMAL(18, 2),
        tax_determination_comparison TEXT,
        tax_determination_status VARCHAR(50),

        -- Metadata
        source_file VARCHAR(500),
        stamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        modified_stamp TIMESTAMP WITH TIME ZONE,

        -- Unique constraint: document + item serial number
        CONSTRAINT sales_unique_record UNIQUE (document_number, document_date, location_gstin, serial_number)
    );

    -- Create indexes for better query performance
    CREATE INDEX IF NOT EXISTS idx_sales_location_gstin ON sales(location_gstin);
    CREATE INDEX IF NOT EXISTS idx_sales_document_date ON sales(document_date);
    CREATE INDEX IF NOT EXISTS idx_sales_document_number ON sales(document_number);
    CREATE INDEX IF NOT EXISTS idx_sales_stamp ON sales(stamp);
    CREATE INDEX IF NOT EXISTS idx_sales_return_period ON sales(return_period);
    """

    with conn.cursor() as cur:
        cur.execute(create_table_sql)
        conn.commit()
        logger.info("Sales table ensured to exist")


def flatten_record_with_items(record: Dict[str, Any], source_file: str) -> List[Dict[str, Any]]:
    """
    Flatten a single record with items into multiple rows.
    Each item becomes a separate row with all document-level fields repeated.
    """
    items = record.get('items', [])

    # If no items, create one row with serial_number = 1
    if not items:
        items = [{}]

    flattened_rows = []

    for idx, item in enumerate(items, start=1):
        row = {
            # Location info
            'location_gstin': record.get('locationGstin'),
            'location_name': record.get('locationName'),

            # Return info
            'return_period': record.get('returnPeriod'),
            'liability_discharge_return_period': record.get('liabilityDischargeReturnPeriod'),
            'purpose': record.get('purpose'),
            'auto_push_or_generate': record.get('autoPushOrGenerate'),
            'supply_type': record.get('supplyType'),
            'irn': record.get('irn'),

            # Document info
            'document_type': record.get('documentType'),
            'transaction_type': record.get('transactionType'),
            'taxpayer_type': record.get('taxpayerType'),
            'transaction_nature': record.get('transactionNature'),
            'document_number': record.get('documentNumber'),
            'document_date': record.get('documentDate'),

            # Bill From info
            'bill_from_gstin': record.get('billFromGstin'),
            'bill_from_legal_name': record.get('billFromLegalName'),
            'bill_from_trade_name': record.get('billFromTradeName'),
            'bill_from_vendor_code': record.get('billFromVendorCode'),
            'bill_from_address1': record.get('billFromAddress1'),
            'bill_from_address2': record.get('billFromAddress2'),
            'bill_from_city': record.get('billFromCity'),
            'bill_from_state_code': record.get('billFromStateCode'),
            'bill_from_pincode': record.get('billFromPincode'),
            'bill_from_phone': record.get('billFromPhone'),
            'bill_from_email': record.get('billFromEmail'),

            # Dispatch From info
            'dispatch_from_gstin': record.get('dispatchFromGstin'),
            'dispatch_from_trade_name': record.get('dispatchFromTradeName'),
            'dispatch_from_vendor_code': record.get('dispatchFromVendorCode'),
            'dispatch_from_address1': record.get('dispatchFromAddress1'),
            'dispatch_from_address2': record.get('dispatchFromAddress2'),
            'dispatch_from_city': record.get('dispatchFromCity'),
            'dispatch_from_state_code': record.get('dispatchFromStateCode'),
            'dispatch_from_pincode': record.get('dispatchFromPincode'),

            # Bill To info
            'bill_to_gstin': record.get('billToGstin'),
            'bill_to_legal_name': record.get('billToLegalName'),
            'bill_to_trade_name': record.get('billToTradeName'),
            'bill_to_vendor_code': record.get('billToVendorCode'),
            'bill_to_address1': record.get('billToAddress1'),
            'bill_to_address2': record.get('billToAddress2'),
            'bill_to_city': record.get('billToCity'),
            'bill_to_state_code': record.get('billToStateCode'),
            'bill_to_pincode': record.get('billToPincode'),
            'bill_to_phone': record.get('billToPhone'),
            'bill_to_email': record.get('billToEmail'),

            # Ship To info
            'ship_to_gstin': record.get('shipToGstin'),
            'ship_to_legal_name': record.get('shipToLegalName'),
            'ship_to_trade_name': record.get('shipToTradeName'),
            'ship_to_vendor_code': record.get('shipToVendorCode'),
            'ship_to_address1': record.get('shipToAddress1'),
            'ship_to_address2': record.get('shipToAddress2'),
            'ship_to_city': record.get('shipToCity'),
            'ship_to_state_code': record.get('shipToStateCode'),
            'ship_to_pincode': record.get('shipToPincode'),

            # Payment info
            'payment_type': record.get('paymentType'),
            'payment_mode': record.get('paymentMode'),
            'payment_amount': record.get('paymentAmount'),
            'advance_paid_amount': record.get('advancePaidAmount'),
            'payment_date': record.get('paymentDate'),
            'payment_remarks': record.get('paymentRemarks'),
            'payment_terms': record.get('paymentTerms'),
            'payment_instruction': record.get('paymentInstruction'),
            'payee_name': record.get('payeeName'),
            'payee_account_number': record.get('payeeAccountNumber'),
            'payment_amount_due': record.get('paymentAmountDue'),
            'ifsc': record.get('ifsc'),
            'credit_transfer': record.get('creditTransfer'),
            'direct_debit': record.get('directDebit'),
            'credit_days': record.get('creditDays'),

            # Reference document info
            'ref_document_remarks': record.get('refDocumentRemarks'),
            'ref_document_period_start_date': record.get('refDocumentPeriodStartDate'),
            'ref_document_period_end_date': record.get('refDocumentPeriodEndDate'),
            'ref_preceding_document_details': json.dumps(record.get('refPrecedingDocumentDetails')) if record.get('refPrecedingDocumentDetails') else None,
            'ref_contract_details': json.dumps(record.get('refContractDetails')) if record.get('refContractDetails') else None,
            'additional_supporting_document_details': json.dumps(record.get('additionalSupportingDocumentDetails')) if record.get('additionalSupportingDocumentDetails') else None,

            # Bill info
            'bill_number': record.get('billNumber'),
            'bill_date': record.get('billDate'),
            'port_code': record.get('portCode'),
            'document_currency_code': record.get('documentCurrencyCode'),
            'destination_country': record.get('destinationCountry'),
            'pos': record.get('pos'),
            'document_value': record.get('documentValue'),
            'document_discount': record.get('documentDiscount'),
            'document_other_charges': record.get('documentOtherCharges'),
            'document_value_in_foreign_currency': record.get('documentValueInForeignCurrency'),
            'round_off_amount': record.get('roundOffAmount'),
            'differential_percentage': record.get('differentialPercentage'),
            'reverse_charge': record.get('reverseCharge'),
            'claim_refund': record.get('claimRefund'),
            'under_igst_act': record.get('underIgstAct'),
            'refund_eligibility': record.get('refundEligibility'),
            'e_commerce_gstin': record.get('eCommerceGstin'),
            'tds_gstin': record.get('tdsGstin'),

            # Original document info
            'original_gstin': record.get('originalGstin'),
            'original_state_code': record.get('originalStateCode'),
            'original_document_number': record.get('originalDocumentNumber'),
            'original_document_date': record.get('originalDocumentDate'),
            'original_return_period': record.get('originalReturnPeriod'),
            'original_taxable_value': record.get('originalTaxableValue'),

            # Communication
            'to_email_addresses': record.get('toEmailAddresses'),
            'to_mobile_numbers': record.get('toMobileNumbers'),

            # JW fields
            'jw_original_document_number': record.get('jWOriginalDocumentNumber'),
            'jw_original_document_date': record.get('jWOriginalDocumentDate'),
            'jw_document_number': record.get('jWDocumentNumber'),
            'jw_document_date': record.get('jWDocumentDate'),

            # Custom fields (document level)
            'custom1': record.get('custom1'),
            'custom2': record.get('custom2'),
            'custom3': record.get('custom3'),
            'custom4': record.get('custom4'),
            'custom5': record.get('custom5'),
            'custom6': record.get('custom6'),
            'custom7': record.get('custom7'),
            'custom8': record.get('custom8'),
            'custom9': record.get('custom9'),
            'custom10': record.get('custom10'),

            # Item fields - use item's serialNumber if present, otherwise use index
            'serial_number': item.get('serialNumber') if item.get('serialNumber') else idx,
            'is_service': item.get('isService'),
            'hsn': item.get('hsn'),
            'product_code': item.get('productCode'),
            'item_name': item.get('name'),
            'item_description': item.get('description'),
            'nature_of_jw_done': item.get('natureOfJWDone'),
            'barcode': item.get('barcode'),
            'uqc': item.get('uqc'),
            'quantity': item.get('quantity'),
            'free_quantity': item.get('freeQuantity'),
            'loss_unit_of_measure': item.get('lossUnitOfMeasure'),
            'loss_total_quantity': item.get('lossTotalQuantity'),
            'rate': item.get('rate'),
            'cess_rate': item.get('cessRate'),
            'state_cess_rate': item.get('stateCessRate'),
            'cess_non_advalorem_rate': item.get('cessNonAdvaloremRate'),
            'price_per_quantity': item.get('pricePerQuantity'),
            'discount_amount': item.get('discountAmount'),
            'gross_amount': item.get('grossAmount'),
            'other_charges': item.get('otherCharges'),
            'taxable_value': item.get('taxableValue'),
            'igst_amount': item.get('igstAmount'),
            'cgst_amount': item.get('cgstAmount'),
            'sgst_amount': item.get('sgstAmount'),
            'cess_amount': item.get('cessAmount'),
            'state_cess_amount': item.get('stateCessAmount'),
            'state_cess_non_advalorem_amount': item.get('stateCessNonAdvaloremAmount'),
            'cess_non_advalorem_amount': item.get('cessNonAdvaloremAmount'),
            'tax_type': item.get('taxType'),

            # Custom item fields
            'custom_item1': item.get('customItem1'),
            'custom_item2': item.get('customItem2'),
            'custom_item3': item.get('customItem3'),
            'custom_item4': item.get('customItem4'),
            'custom_item5': item.get('customItem5'),
            'custom_item6': item.get('customItem6'),
            'custom_item7': item.get('customItem7'),
            'custom_item8': item.get('customItem8'),
            'custom_item9': item.get('customItem9'),
            'custom_item10': item.get('customItem10'),

            # Transaction info
            'transaction_id': record.get('transactionId') or item.get('transactionId'),
            'transaction_note': record.get('transactionNote'),
            'push_errors': record.get('pushErrors'),
            'ogst_push_status': record.get('pushStatus'),
            'gst_action': record.get('gstAction'),
            'reconciliation_section': record.get('reconciliationSection'),
            'push_date': record.get('pushDate'),
            'is_pre_gst_regime': record.get('isPreGstRegime'),
            'filing_status': record.get('filingStatus'),
            'irn_generation_date': record.get('irnGenerationDate'),
            'auto_draft_source': record.get('autoDraftSource'),
            'is_amendment': record.get('isAmendment'),
            'upi_id': record.get('upiId'),
            'gst_act_or_rule_section': item.get('gstActOrRuleSection'),
            'reference_id': record.get('referenceId'),
            'uploaded_or_downloaded_datetime': record.get('uploadedOrDownloadedDateTime'),
            'payment_due_date': record.get('paymentDueDate'),
            'gstr3b_section': record.get('gstr3BSection'),
            'cancelled_date': record.get('cancelledDate'),
            'gstr1_section': record.get('gstr1Section'),
            'inter_intra': record.get('interIntra'),

            # Custom fields (11-20)
            'custom11': record.get('custom11'),
            'custom12': record.get('custom12'),
            'custom13': record.get('custom13'),
            'custom14': record.get('custom14'),
            'custom15': record.get('custom15'),
            'custom16': record.get('custom16'),
            'custom17': record.get('custom17'),
            'custom18': record.get('custom18'),
            'custom19': record.get('custom19'),
            'custom20': record.get('custom20'),

            # Custom item fields (11-20)
            'custom_item11': item.get('customItem11'),
            'custom_item12': item.get('customItem12'),
            'custom_item13': item.get('customItem13'),
            'custom_item14': item.get('customItem14'),
            'custom_item15': item.get('customItem15'),
            'custom_item16': item.get('customItem16'),
            'custom_item17': item.get('customItem17'),
            'custom_item18': item.get('customItem18'),
            'custom_item19': item.get('customItem19'),
            'custom_item20': item.get('customItem20'),

            # Additional fields
            'return_type': record.get('returnType'),
            'counter_party_action': record.get('counterPartAction'),
            'credit_note_reason': record.get('creditNoteReason'),
            'counter_party_remarks': record.get('counterPartyRemarks'),
            'determined_rate': record.get('determinedRate'),
            'determined_taxable': record.get('determinedTaxable'),
            'determined_igst': record.get('determinedIGST'),
            'determined_cgst': record.get('determinedCGST'),
            'determined_sgst': record.get('determinedSGST'),
            'tax_determination_comparison': record.get('taxDeterminationComparison'),
            'tax_determination_status': record.get('taxDeterminationStatus'),

            # Metadata
            'source_file': source_file,
        }

        flattened_rows.append(row)

    return flattened_rows


def upsert_sales_records(conn, records: List[Dict[str, Any]], source_file: str) -> Tuple[int, int]:
    """
    Insert or update sales records into the tenant database.
    Each record with multiple items is flattened into multiple rows.
    Returns (inserted_count, updated_count)
    """
    if not records:
        return 0, 0

    inserted_count = 0
    updated_count = 0

    # Column names for insert
    columns = [
        'location_gstin', 'location_name', 'return_period', 'liability_discharge_return_period',
        'purpose', 'auto_push_or_generate', 'supply_type', 'irn', 'document_type', 'transaction_type',
        'taxpayer_type', 'transaction_nature', 'document_number', 'document_date',
        'bill_from_gstin', 'bill_from_legal_name', 'bill_from_trade_name', 'bill_from_vendor_code',
        'bill_from_address1', 'bill_from_address2', 'bill_from_city', 'bill_from_state_code',
        'bill_from_pincode', 'bill_from_phone', 'bill_from_email',
        'dispatch_from_gstin', 'dispatch_from_trade_name', 'dispatch_from_vendor_code',
        'dispatch_from_address1', 'dispatch_from_address2', 'dispatch_from_city',
        'dispatch_from_state_code', 'dispatch_from_pincode',
        'bill_to_gstin', 'bill_to_legal_name', 'bill_to_trade_name', 'bill_to_vendor_code',
        'bill_to_address1', 'bill_to_address2', 'bill_to_city', 'bill_to_state_code',
        'bill_to_pincode', 'bill_to_phone', 'bill_to_email',
        'ship_to_gstin', 'ship_to_legal_name', 'ship_to_trade_name', 'ship_to_vendor_code',
        'ship_to_address1', 'ship_to_address2', 'ship_to_city', 'ship_to_state_code', 'ship_to_pincode',
        'payment_type', 'payment_mode', 'payment_amount', 'advance_paid_amount', 'payment_date',
        'payment_remarks', 'payment_terms', 'payment_instruction', 'payee_name', 'payee_account_number',
        'payment_amount_due', 'ifsc', 'credit_transfer', 'direct_debit', 'credit_days',
        'ref_document_remarks', 'ref_document_period_start_date', 'ref_document_period_end_date',
        'ref_preceding_document_details', 'ref_contract_details', 'additional_supporting_document_details',
        'bill_number', 'bill_date', 'port_code', 'document_currency_code', 'destination_country',
        'pos', 'document_value', 'document_discount', 'document_other_charges',
        'document_value_in_foreign_currency', 'round_off_amount', 'differential_percentage',
        'reverse_charge', 'claim_refund', 'under_igst_act', 'refund_eligibility',
        'e_commerce_gstin', 'tds_gstin',
        'original_gstin', 'original_state_code', 'original_document_number', 'original_document_date',
        'original_return_period', 'original_taxable_value',
        'to_email_addresses', 'to_mobile_numbers',
        'jw_original_document_number', 'jw_original_document_date', 'jw_document_number', 'jw_document_date',
        'custom1', 'custom2', 'custom3', 'custom4', 'custom5', 'custom6', 'custom7', 'custom8', 'custom9', 'custom10',
        'serial_number', 'is_service', 'hsn', 'product_code', 'item_name', 'item_description',
        'nature_of_jw_done', 'barcode', 'uqc', 'quantity', 'free_quantity', 'loss_unit_of_measure',
        'loss_total_quantity', 'rate', 'cess_rate', 'state_cess_rate', 'cess_non_advalorem_rate',
        'price_per_quantity', 'discount_amount', 'gross_amount', 'other_charges', 'taxable_value',
        'igst_amount', 'cgst_amount', 'sgst_amount', 'cess_amount', 'state_cess_amount',
        'state_cess_non_advalorem_amount', 'cess_non_advalorem_amount', 'tax_type',
        'custom_item1', 'custom_item2', 'custom_item3', 'custom_item4', 'custom_item5',
        'custom_item6', 'custom_item7', 'custom_item8', 'custom_item9', 'custom_item10',
        'transaction_id', 'transaction_note', 'push_errors', 'ogst_push_status', 'gst_action',
        'reconciliation_section', 'push_date', 'is_pre_gst_regime', 'filing_status', 'irn_generation_date',
        'auto_draft_source', 'is_amendment', 'upi_id', 'gst_act_or_rule_section', 'reference_id',
        'uploaded_or_downloaded_datetime', 'payment_due_date', 'gstr3b_section', 'cancelled_date',
        'gstr1_section', 'inter_intra',
        'custom11', 'custom12', 'custom13', 'custom14', 'custom15', 'custom16', 'custom17', 'custom18', 'custom19', 'custom20',
        'custom_item11', 'custom_item12', 'custom_item13', 'custom_item14', 'custom_item15',
        'custom_item16', 'custom_item17', 'custom_item18', 'custom_item19', 'custom_item20',
        'return_type', 'counter_party_action', 'credit_note_reason', 'counter_party_remarks',
        'determined_rate', 'determined_taxable', 'determined_igst', 'determined_cgst', 'determined_sgst',
        'tax_determination_comparison', 'tax_determination_status',
        'source_file'
    ]

    columns_str = ', '.join(columns)
    placeholders = ', '.join(['%s'] * len(columns))

    # Build update clause - exclude unique constraint columns
    update_columns = [c for c in columns if c not in ['document_number', 'document_date', 'location_gstin', 'serial_number']]
    update_clause = ', '.join([f"{c} = EXCLUDED.{c}" for c in update_columns])
    update_clause += ", modified_stamp = CURRENT_TIMESTAMP"

    upsert_sql = f"""
        INSERT INTO sales ({columns_str})
        VALUES ({placeholders})
        ON CONFLICT (document_number, document_date, location_gstin, serial_number)
        DO UPDATE SET {update_clause}
        RETURNING (xmax = 0) as is_insert
    """

    with conn.cursor() as cur:
        for record in records:
            # Flatten record with items into multiple rows
            flattened_rows = flatten_record_with_items(record, source_file)

            for row in flattened_rows:
                values = [row.get(col) for col in columns]

                try:
                    cur.execute(upsert_sql, values)
                    result = cur.fetchone()
                    if result and result[0]:
                        inserted_count += 1
                    else:
                        updated_count += 1
                except Exception as e:
                    logger.error(f"Error upserting record {record.get('documentNumber')}, serial {row.get('serial_number')}: {e}")
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
        logger.warning(f"Could not get processed files (table may not exist): {e}")
        return set()
