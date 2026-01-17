import { Pool } from 'pg';

export interface EntityData {
  entityId?: string;
  legalName?: string;
  tradeName?: string;
  gstin?: string;
  pan?: string;
  entityType?: string;
  registrationStatus?: string;
  stateCode?: string;
  stateName?: string;
  address?: string;
  pincode?: string;
  email?: string;
  phone?: string;
  constitutionOfBusiness?: string;
  taxpayerType?: string;
  registrationDate?: string;
  cancellationDate?: string;
  lastUpdatedDate?: string;
  rawData?: Record<string, unknown>;
}

/**
 * Fetch entities from the external API
 */
export async function fetchEntitiesFromApi(
  subscriberUrl: string,
  authToken: string,
  start: number = 0,
  size: number = 1000
): Promise<{ entities: Record<string, unknown>[]; total: number }> {
  // Ensure URL doesn't have trailing slash
  const baseUrl = subscriberUrl.replace(/\/+$/, '');
  const apiUrl = `${baseUrl}/enriched/v0.1/entity/export`;

  console.log(`Fetching entities from: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'auth-token': authToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      start,
      size,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();

  // Log the raw response structure for debugging
  console.log('API Response keys:', JSON.stringify(Object.keys(data)));

  // Handle different response formats - the API returns "result" array
  const entities = data.result || data.data || data.entities || data.items || [];
  const total = data.totalRecords || data.total || data.count || entities.length;

  console.log(`Fetched ${entities.length} entities, total records: ${total}`);

  return { entities, total };
}

/**
 * Map API response to database entity format
 * Based on actual API response structure:
 * - id: unique identifier (encrypted)
 * - entityName: name of the entity
 * - entityGstin: GSTIN number
 * - entityType: "Business" or "Location"
 * - parentEntityName: parent entity for Location types
 * - taxpayerType: "REG", "SEZ", "ISD", etc.
 * - gstStatus: GST status
 * - gstUserId: GST user ID
 * - emailAddressForGstNotification: email
 * - mobileNumberForGstNotification: phone
 * - profileType: profile type
 * - gstReturnFiling: Y/N
 * - eInvoiceGeneration: Y/N
 * - ewayBillGeneration: Y/N
 * - isTransporter: Y/N
 */
export function mapEntityToDbFormat(entity: Record<string, unknown>): EntityData {
  // Extract GSTIN and derive state code from it (first 2 digits)
  const gstin = entity.entityGstin as string | undefined;
  let stateCode: string | undefined;

  if (gstin && gstin.length >= 2) {
    stateCode = gstin.substring(0, 2);
  }

  // Map state code to state name
  const stateCodeToName: Record<string, string> = {
    '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab',
    '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
    '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
    '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
    '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram',
    '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam',
    '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
    '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    '25': 'Daman & Diu', '26': 'Dadra & Nagar Haveli', '27': 'Maharashtra',
    '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa',
    '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
    '34': 'Puducherry', '35': 'Andaman & Nicobar', '36': 'Telangana',
    '37': 'Andhra Pradesh (New)', '38': 'Ladakh',
  };

  const stateName = stateCode ? stateCodeToName[stateCode] : undefined;

  // Extract PAN from GSTIN (characters 3-12)
  let pan: string | undefined;
  if (gstin && gstin.length >= 12) {
    pan = gstin.substring(2, 12);
  }

  return {
    entityId: entity.id as string | undefined,
    legalName: entity.entityName as string | undefined,
    tradeName: entity.parentEntityName as string | undefined,
    gstin: gstin,
    pan: pan,
    entityType: entity.entityType as string | undefined,
    registrationStatus: entity.gstStatus as string | undefined,
    stateCode: stateCode,
    stateName: stateName,
    address: null as unknown as string | undefined, // Not available in API
    pincode: null as unknown as string | undefined, // Not available in API
    email: (entity.emailAddressForGstNotification || entity.emailAddressForEinvNotification || entity.emailAddressForEwbNotification) as string | undefined,
    phone: (entity.mobileNumberForGstNotification || entity.mobileNumberForEinvNotification || entity.mobileNumberForEwbNotification) as string | undefined,
    constitutionOfBusiness: entity.profileType as string | undefined,
    taxpayerType: entity.taxpayerType as string | undefined,
    registrationDate: null as unknown as string | undefined, // Not available in API
    cancellationDate: null as unknown as string | undefined, // Not available in API
    lastUpdatedDate: null as unknown as string | undefined, // Not available in API
    rawData: entity,
  };
}

/**
 * Insert entities into tenant database
 */
export async function insertEntitiesIntoTenantDb(
  tenantPool: Pool,
  entities: Record<string, unknown>[]
): Promise<number> {
  if (entities.length === 0) {
    return 0;
  }

  const client = await tenantPool.connect();
  let insertedCount = 0;

  try {
    await client.query('BEGIN');

    for (const entity of entities) {
      const mappedEntity = mapEntityToDbFormat(entity);

      // Use the entity id from API as entity_id
      const entityId = mappedEntity.entityId || `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      try {
        await client.query(
          `INSERT INTO entities (
            entity_id, legal_name, trade_name, gstin, pan,
            entity_type, registration_status, state_code, state_name,
            address, pincode, email, phone, constitution_of_business,
            taxpayer_type, registration_date, cancellation_date,
            last_updated_date, raw_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (entity_id) DO UPDATE SET
            legal_name = COALESCE(EXCLUDED.legal_name, entities.legal_name),
            trade_name = COALESCE(EXCLUDED.trade_name, entities.trade_name),
            gstin = COALESCE(EXCLUDED.gstin, entities.gstin),
            pan = COALESCE(EXCLUDED.pan, entities.pan),
            entity_type = COALESCE(EXCLUDED.entity_type, entities.entity_type),
            registration_status = COALESCE(EXCLUDED.registration_status, entities.registration_status),
            state_code = COALESCE(EXCLUDED.state_code, entities.state_code),
            state_name = COALESCE(EXCLUDED.state_name, entities.state_name),
            address = COALESCE(EXCLUDED.address, entities.address),
            pincode = COALESCE(EXCLUDED.pincode, entities.pincode),
            email = COALESCE(EXCLUDED.email, entities.email),
            phone = COALESCE(EXCLUDED.phone, entities.phone),
            constitution_of_business = COALESCE(EXCLUDED.constitution_of_business, entities.constitution_of_business),
            taxpayer_type = COALESCE(EXCLUDED.taxpayer_type, entities.taxpayer_type),
            registration_date = COALESCE(EXCLUDED.registration_date, entities.registration_date),
            cancellation_date = COALESCE(EXCLUDED.cancellation_date, entities.cancellation_date),
            last_updated_date = COALESCE(EXCLUDED.last_updated_date, entities.last_updated_date),
            raw_data = EXCLUDED.raw_data,
            updated_at = CURRENT_TIMESTAMP`,
          [
            entityId,
            mappedEntity.legalName || null,
            mappedEntity.tradeName || null,
            mappedEntity.gstin || null,
            mappedEntity.pan || null,
            mappedEntity.entityType || null,
            mappedEntity.registrationStatus || null,
            mappedEntity.stateCode || null,
            mappedEntity.stateName || null,
            mappedEntity.address || null,
            mappedEntity.pincode || null,
            mappedEntity.email || null,
            mappedEntity.phone || null,
            mappedEntity.constitutionOfBusiness || null,
            mappedEntity.taxpayerType || null,
            null, // registration_date not available
            null, // cancellation_date not available
            null, // last_updated_date not available
            JSON.stringify(mappedEntity.rawData || {}),
          ]
        );
        insertedCount++;
      } catch (err) {
        console.error('Error inserting entity:', err);
        console.error('Entity data:', JSON.stringify(mappedEntity, null, 2));
        // Continue with next entity
      }
    }

    await client.query('COMMIT');
    return insertedCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Fetch all entities with pagination from external API and store in tenant database
 */
export async function syncEntitiesForSubscriber(
  subscriberUrl: string,
  authToken: string,
  tenantPool: Pool
): Promise<{ totalFetched: number; totalInserted: number }> {
  let totalFetched = 0;
  let totalInserted = 0;
  let start = 0;
  const size = 1000;
  let hasMore = true;

  console.log(`Starting entity sync from ${subscriberUrl}`);

  while (hasMore) {
    try {
      const { entities, total } = await fetchEntitiesFromApi(subscriberUrl, authToken, start, size);

      if (entities.length === 0) {
        hasMore = false;
        break;
      }

      // Log first entity for debugging
      if (start === 0 && entities.length > 0) {
        console.log('Sample entity from API:', JSON.stringify(entities[0], null, 2));
        const mapped = mapEntityToDbFormat(entities[0]);
        console.log('Mapped entity:', JSON.stringify(mapped, null, 2));
      }

      totalFetched += entities.length;
      const inserted = await insertEntitiesIntoTenantDb(tenantPool, entities);
      totalInserted += inserted;

      console.log(`Fetched ${entities.length} entities (total: ${totalFetched}/${total}), inserted: ${inserted}`);

      // Check if we've fetched all entities
      if (entities.length < size || totalFetched >= total) {
        hasMore = false;
      } else {
        start += size;
      }
    } catch (error) {
      console.error('Error during entity sync:', error);
      throw error;
    }
  }

  console.log(`Entity sync completed. Total fetched: ${totalFetched}, Total inserted: ${totalInserted}`);
  return { totalFetched, totalInserted };
}
