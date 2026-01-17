'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Building2,
  Download,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

interface Entity {
  id: number;
  entityId: string;
  legalName: string;
  tradeName: string;
  gstin: string;
  pan: string;
  entityType: string;
  registrationStatus: string;
  stateCode: string;
  stateName: string;
  address: string;
  pincode: string;
  email: string;
  phone: string;
  constitutionOfBusiness: string;
  taxpayerType: string;
  registrationDate: string;
  cancellationDate: string;
  lastUpdatedDate: string;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function EntitiesPage() {
  const params = useParams();
  const router = useRouter();
  const subscriberId = params.id as string;

  const [entities, setEntities] = useState<Entity[]>([]);
  const [subscriberName, setSubscriberName] = useState('');
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'ASC' | 'DESC'>('DESC');

  const fetchEntities = useCallback(async () => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        search,
        sortBy,
        sortOrder,
      });

      const response = await fetch(`/api/subscribers/${subscriberId}/entities?${queryParams}`);
      const data = await response.json();

      if (data.success) {
        setEntities(data.data.entities);
        setSubscriberName(data.data.subscriberName);
        setPagination(data.data.pagination);
      } else {
        toast.error(data.error || 'Failed to fetch entities');
      }
    } catch (error) {
      console.error('Error fetching entities:', error);
      toast.error('Failed to fetch entities');
    } finally {
      setIsLoading(false);
    }
  }, [subscriberId, pagination.page, pagination.limit, search, sortBy, sortOrder]);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/subscribers/${subscriberId}/entities`, {
        method: 'POST',
      });
      const data = await response.json();

      if (data.success) {
        toast.success(`Synced ${data.data.totalInserted} entities`);
        fetchEntities();
      } else {
        toast.error(data.error || 'Failed to sync entities');
      }
    } catch (error) {
      console.error('Error syncing entities:', error);
      toast.error('Failed to sync entities');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(prev => (prev === 'ASC' ? 'DESC' : 'ASC'));
    } else {
      setSortBy(field);
      setSortOrder('ASC');
    }
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setPagination(prev => ({ ...prev, page: newPage }));
    }
  };

  const getStatusBadgeClass = (status: string) => {
    if (!status) return 'badge-secondary';
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('active')) return 'badge-success';
    if (lowerStatus.includes('cancelled') || lowerStatus.includes('inactive')) return 'badge-error';
    if (lowerStatus.includes('suspended')) return 'badge-warning';
    return 'badge-info';
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return null;
    return (
      <span style={{ marginLeft: '0.25rem' }}>
        {sortOrder === 'ASC' ? '↑' : '↓'}
      </span>
    );
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => router.push('/subscribers')}
            style={{ padding: '0.5rem' }}
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="page-title">Entities</h1>
            <p className="page-description">
              {subscriberName || subscriberId} - {pagination.total} entities
            </p>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleSync}
          disabled={isSyncing}
        >
          {isSyncing ? (
            <>
              <Loader2 size={16} className="spinner" />
              Syncing...
            </>
          ) : (
            <>
              <RefreshCw size={16} />
              Sync Entities
            </>
          )}
        </button>
      </div>

      {/* Search and Filter Bar */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-body" style={{ padding: '1rem' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search
                size={18}
                style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-secondary)',
                }}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Search by name, GSTIN, PAN, or state..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                style={{ paddingLeft: '2.5rem' }}
              />
            </div>
            <button type="submit" className="btn btn-primary">
              Search
            </button>
            {search && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setSearch('');
                  setSearchInput('');
                  setPagination(prev => ({ ...prev, page: 1 }));
                }}
              >
                Clear
              </button>
            )}
          </form>
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
          <Loader2 size={32} className="spinner" />
        </div>
      ) : entities.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Building2 size={64} className="empty-state-icon" />
            <h3 className="empty-state-title">
              {search ? 'No entities found' : 'No entities yet'}
            </h3>
            <p className="empty-state-description">
              {search
                ? 'Try adjusting your search criteria'
                : 'Click "Sync Entities" to fetch entity data from the API'}
            </p>
            {!search && (
              <button className="btn btn-primary" onClick={handleSync} disabled={isSyncing}>
                <RefreshCw size={16} />
                Sync Entities
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleSort('legal_name')}
                    >
                      Legal Name <SortIcon field="legal_name" />
                    </th>
                    <th
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleSort('gstin')}
                    >
                      GSTIN <SortIcon field="gstin" />
                    </th>
                    <th
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleSort('pan')}
                    >
                      PAN <SortIcon field="pan" />
                    </th>
                    <th
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleSort('state_name')}
                    >
                      State <SortIcon field="state_name" />
                    </th>
                    <th
                      style={{ cursor: 'pointer' }}
                      onClick={() => handleSort('entity_type')}
                    >
                      Entity Type <SortIcon field="entity_type" />
                    </th>
                    <th>Taxpayer Type</th>
                    <th>Registration Date</th>
                  </tr>
                </thead>
                <tbody>
                  {entities.map((entity) => (
                    <tr key={entity.id}>
                      <td>
                        <div style={{ fontWeight: 500, maxWidth: '250px' }}>
                          {entity.legalName || '-'}
                        </div>
                        {entity.tradeName && entity.tradeName !== entity.legalName && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Trade: {entity.tradeName}
                          </div>
                        )}
                      </td>
                      <td>
                        <code style={{
                          backgroundColor: 'var(--background)',
                          padding: '0.125rem 0.375rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                        }}>
                          {entity.gstin || '-'}
                        </code>
                      </td>
                      <td>
                        <code style={{
                          backgroundColor: 'var(--background)',
                          padding: '0.125rem 0.375rem',
                          borderRadius: '0.25rem',
                          fontSize: '0.75rem',
                        }}>
                          {entity.pan || '-'}
                        </code>
                      </td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {entity.stateName || entity.stateCode || '-'}
                      </td>
                      <td>
                        <span className={`badge ${entity.entityType === 'Business' ? 'badge-info' : 'badge-secondary'}`}>
                          {entity.entityType || '-'}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {entity.taxpayerType || '-'}
                      </td>
                      <td style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        {entity.registrationDate
                          ? format(new Date(entity.registrationDate), 'MMM d, yyyy')
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '1.5rem',
            padding: '0 0.5rem',
          }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{' '}
              {pagination.total} entities
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                style={{ padding: '0.5rem' }}
              >
                <ChevronLeft size={18} />
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {/* First page */}
                {pagination.page > 2 && (
                  <>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handlePageChange(1)}
                      style={{ padding: '0.5rem 0.75rem', minWidth: '2.5rem' }}
                    >
                      1
                    </button>
                    {pagination.page > 3 && (
                      <span style={{ padding: '0 0.25rem', color: 'var(--text-secondary)' }}>...</span>
                    )}
                  </>
                )}

                {/* Page numbers around current */}
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  let pageNum;
                  if (pagination.totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (pagination.page <= 3) {
                    pageNum = i + 1;
                  } else if (pagination.page >= pagination.totalPages - 2) {
                    pageNum = pagination.totalPages - 4 + i;
                  } else {
                    pageNum = pagination.page - 2 + i;
                  }

                  if (pageNum < 1 || pageNum > pagination.totalPages) return null;
                  if (pageNum === 1 && pagination.page > 2) return null;
                  if (pageNum === pagination.totalPages && pagination.page < pagination.totalPages - 1) return null;

                  return (
                    <button
                      key={pageNum}
                      className={`btn ${pagination.page === pageNum ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handlePageChange(pageNum)}
                      style={{ padding: '0.5rem 0.75rem', minWidth: '2.5rem' }}
                    >
                      {pageNum}
                    </button>
                  );
                })}

                {/* Last page */}
                {pagination.page < pagination.totalPages - 1 && pagination.totalPages > 5 && (
                  <>
                    {pagination.page < pagination.totalPages - 2 && (
                      <span style={{ padding: '0 0.25rem', color: 'var(--text-secondary)' }}>...</span>
                    )}
                    <button
                      className="btn btn-secondary"
                      onClick={() => handlePageChange(pagination.totalPages)}
                      style={{ padding: '0.5rem 0.75rem', minWidth: '2.5rem' }}
                    >
                      {pagination.totalPages}
                    </button>
                  </>
                )}
              </div>

              <button
                className="btn btn-secondary"
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={pagination.page >= pagination.totalPages}
                style={{ padding: '0.5rem' }}
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <select
              className="form-select"
              value={pagination.limit}
              onChange={(e) => {
                setPagination(prev => ({ ...prev, limit: parseInt(e.target.value), page: 1 }));
              }}
              style={{ width: 'auto' }}
            >
              <option value="10">10 per page</option>
              <option value="20">20 per page</option>
              <option value="50">50 per page</option>
              <option value="100">100 per page</option>
            </select>
          </div>
        </>
      )}
    </div>
  );
}
