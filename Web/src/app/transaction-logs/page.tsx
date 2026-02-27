'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Loader2,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  Filter,
  X,
  Eye,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/Modal';
import { format, formatDistanceToNow } from 'date-fns';

interface TransactionLog {
  id: number;
  module: string;
  requestUrl: string;
  requestMethod: string;
  requestHeaders: Record<string, unknown>;
  requestBody: Record<string, unknown>;
  responseStatusCode: number;
  responseHeaders: Record<string, unknown>;
  responseFilePath: string | null;
  gstin: string;
  fromStamp: string | null;
  toStamp: string | null;
  stamp: string;
  executionTimeMs: number;
  isSuccess: boolean;
  errorMessage: string | null;
}

interface Subscriber {
  subscriberId: string;
  subscriberName: string;
}

const MODULE_COLORS: Record<string, string> = {
  sale: 'badge-info',
  purchase: 'badge-success',
  einvoice: 'badge-warning',
  ewaybill: 'badge-secondary',
  creditnote: 'badge-error',
  debitnote: 'badge-primary',
};

export default function TransactionLogsPage() {
  const searchParams = useSearchParams();
  const initialSubscriberId = searchParams.get('subscriberId') || '';

  const [logs, setLogs] = useState<TransactionLog[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedLog, setSelectedLog] = useState<TransactionLog | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<number>>(new Set());
  const [showGstinSuggestions, setShowGstinSuggestions] = useState(false);

  // Filter state
  const [selectedSubscriberId, setSelectedSubscriberId] = useState(initialSubscriberId);
  const [moduleFilter, setModuleFilter] = useState('');
  const [gstinFilter, setGstinFilter] = useState('');
  const [successFilter, setSuccessFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);

  // Filter options
  const [availableModules, setAvailableModules] = useState<string[]>([]);
  const [availableGstins, setAvailableGstins] = useState<string[]>([]);

  // Subscriber info
  const [subscriberName, setSubscriberName] = useState('');

  const fetchSubscribers = async () => {
    try {
      const response = await fetch('/api/subscribers');
      const data = await response.json();

      if (data.success) {
        setSubscribers(data.data.map((s: any) => ({
          subscriberId: s.subscriberId,
          subscriberName: s.subscriberName,
        })));
      }
    } catch (error) {
      console.error('Error fetching subscribers:', error);
    }
  };

  const fetchFilterOptions = async (subscriberId: string) => {
    if (!subscriberId) return;

    try {
      const response = await fetch(`/api/transaction-logs/filters?subscriberId=${subscriberId}`);
      const data = await response.json();

      if (data.success) {
        setAvailableModules(data.data.modules || []);
        setAvailableGstins(data.data.gstins || []);
      }
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  const fetchLogs = async (resetPage = false) => {
    if (!selectedSubscriberId) {
      setLogs([]);
      return;
    }

    setIsLoading(true);
    const currentPage = resetPage ? 1 : page;
    if (resetPage) setPage(1);

    try {
      const params = new URLSearchParams({
        subscriberId: selectedSubscriberId,
        page: currentPage.toString(),
        pageSize: pageSize.toString(),
      });

      if (moduleFilter) params.append('module', moduleFilter);
      if (gstinFilter) params.append('gstin', gstinFilter);
      if (successFilter) params.append('isSuccess', successFilter);
      if (searchQuery) params.append('search', searchQuery);
      if (fromDate) params.append('fromDate', fromDate);
      if (toDate) params.append('toDate', toDate);

      const response = await fetch(`/api/transaction-logs?${params}`);
      const data = await response.json();

      if (data.success) {
        setLogs(data.data.logs);
        setTotal(data.data.total);
        setSubscriberName(data.data.subscriberName);
      } else {
        toast.error(data.error || 'Failed to fetch logs');
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
      toast.error('Failed to fetch logs');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscribers();
  }, []);

  useEffect(() => {
    if (selectedSubscriberId) {
      fetchFilterOptions(selectedSubscriberId);
      fetchLogs(true);
    } else {
      setLogs([]);
      setAvailableModules([]);
      setAvailableGstins([]);
    }
  }, [selectedSubscriberId]);

  useEffect(() => {
    if (selectedSubscriberId) {
      fetchLogs();
    }
  }, [page]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchLogs();
    setIsRefreshing(false);
    toast.success('Logs refreshed');
  };

  const handleApplyFilters = () => {
    fetchLogs(true);
  };

  const handleClearFilters = () => {
    setModuleFilter('');
    setGstinFilter('');
    setSuccessFilter('');
    setSearchQuery('');
    setFromDate('');
    setToDate('');
    fetchLogs(true);
  };

  const toggleLogExpand = (logId: number) => {
    setExpandedLogIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  };

  const openDetailModal = (log: TransactionLog) => {
    setSelectedLog(log);
    setIsDetailModalOpen(true);
  };

  const totalPages = Math.ceil(total / pageSize);

  const hasActiveFilters = moduleFilter || gstinFilter || successFilter || searchQuery || fromDate || toDate;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Transaction Logs</h1>
          <p className="page-description">
            {subscriberName
              ? `API transaction logs for ${subscriberName}`
              : 'View API call logs for your clients'
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={isRefreshing || !selectedSubscriberId}
            title="Refresh"
          >
            <RefreshCw size={16} className={isRefreshing ? 'spinner' : ''} />
          </button>
        </div>
      </div>

      {/* Subscriber Selection */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ minWidth: '250px', flex: 1 }}>
              <label className="form-label">Select Client</label>
              <select
                className="form-select"
                value={selectedSubscriberId}
                onChange={(e) => setSelectedSubscriberId(e.target.value)}
              >
                <option value="">-- Select a client --</option>
                {subscribers.map((s) => (
                  <option key={s.subscriberId} value={s.subscriberId}>
                    {s.subscriberName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      {selectedSubscriberId && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <Filter size={16} />
              <span style={{ fontWeight: 500 }}>Filters</span>
              {hasActiveFilters && (
                <button
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.5rem', marginLeft: 'auto' }}
                  onClick={handleClearFilters}
                >
                  <X size={14} />
                  Clear
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
              <div style={{ minWidth: '150px' }}>
                <label className="form-label">Module</label>
                <select
                  className="form-select"
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value)}
                >
                  <option value="">All Modules</option>
                  {availableModules.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              <div style={{ minWidth: '180px', position: 'relative' }}>
                <label className="form-label">GSTIN</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Type to search GSTIN..."
                  value={gstinFilter}
                  onChange={(e) => {
                    setGstinFilter(e.target.value.toUpperCase());
                    setShowGstinSuggestions(true);
                  }}
                  onFocus={() => setShowGstinSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowGstinSuggestions(false), 150)}
                  maxLength={15}
                  autoComplete="off"
                />
                {showGstinSuggestions && gstinFilter.length >= 2 && (() => {
                  const matches = availableGstins.filter(g =>
                    g.toUpperCase().includes(gstinFilter.toUpperCase())
                  );
                  return matches.length > 0 ? (
                    <ul style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      zIndex: 100,
                      margin: 0,
                      padding: 0,
                      listStyle: 'none',
                      border: '1px solid var(--border)',
                      borderRadius: '0.375rem',
                      backgroundColor: 'var(--surface)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                      maxHeight: '200px',
                      overflowY: 'auto',
                    }}>
                      {matches.map(g => (
                        <li
                          key={g}
                          onMouseDown={() => {
                            setGstinFilter(g);
                            setShowGstinSuggestions(false);
                          }}
                          style={{
                            padding: '0.5rem 0.75rem',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            fontFamily: 'monospace',
                            borderBottom: '1px solid var(--border)',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--background)')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          {g}
                        </li>
                      ))}
                    </ul>
                  ) : null;
                })()}
              </div>

              <div style={{ minWidth: '120px' }}>
                <label className="form-label">Status</label>
                <select
                  className="form-select"
                  value={successFilter}
                  onChange={(e) => setSuccessFilter(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="true">Success</option>
                  <option value="false">Failed</option>
                </select>
              </div>

              <div style={{ minWidth: '150px' }}>
                <label className="form-label">From Date</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                />
              </div>

              <div style={{ minWidth: '150px' }}>
                <label className="form-label">To Date</label>
                <input
                  type="datetime-local"
                  className="form-input"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>

              <div style={{ minWidth: '200px', flex: 1 }}>
                <label className="form-label">Search URL / Error</label>
                <div style={{ position: 'relative' }}>
                  <Search
                    size={16}
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
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: '2.5rem' }}
                  />
                </div>
              </div>

              <button className="btn btn-primary" onClick={handleApplyFilters}>
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logs Table */}
      {!selectedSubscriberId ? (
        <div className="card">
          <div className="empty-state">
            <FileText size={64} className="empty-state-icon" />
            <h3 className="empty-state-title">Select a client</h3>
            <p className="empty-state-description">
              Choose a client from the dropdown above to view their API transaction logs.
            </p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
            <Loader2 size={32} className="spinner" />
          </div>
        </div>
      ) : logs.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <FileText size={64} className="empty-state-icon" />
            <h3 className="empty-state-title">No transaction logs</h3>
            <p className="empty-state-description">
              {hasActiveFilters
                ? 'No logs match the current filters. Try adjusting your filters.'
                : 'No API transaction logs found for this client yet.'
              }
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: '150px' }}>Timestamp</th>
                    <th style={{ width: '90px' }}>Module</th>
                    <th style={{ width: '140px' }}>GSTIN</th>
                    <th>URL</th>
                    <th style={{ width: '80px' }}>Status</th>
                    <th style={{ width: '90px' }}>Time (ms)</th>
                    <th style={{ width: '80px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const isExpanded = expandedLogIds.has(log.id);
                    const errorMsg = log.errorMessage || '';
                    const hasLongError = errorMsg.length > 50;

                    return (
                      <tr key={log.id} style={{ verticalAlign: 'top' }}>
                        <td style={{ fontSize: '0.875rem' }}>
                          <div>{format(new Date(log.stamp), 'MMM d, HH:mm:ss')}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {formatDistanceToNow(new Date(log.stamp), { addSuffix: true })}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${MODULE_COLORS[log.module] || 'badge-secondary'}`}>
                            {log.module}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
                          {log.gstin || '-'}
                        </td>
                        <td style={{ fontSize: '0.8rem' }}>
                          <div style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {log.requestUrl}
                          </div>
                          {!log.isSuccess && errorMsg && (
                            <div style={{
                              fontSize: '0.75rem',
                              color: 'var(--error)',
                              marginTop: '0.25rem',
                            }}>
                              {hasLongError && !isExpanded
                                ? errorMsg.substring(0, 50) + '...'
                                : errorMsg
                              }
                              {hasLongError && (
                                <button
                                  onClick={() => toggleLogExpand(log.id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--primary)',
                                    cursor: 'pointer',
                                    padding: '0 0.25rem',
                                    fontSize: '0.7rem',
                                  }}
                                >
                                  {isExpanded ? 'less' : 'more'}
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            {log.isSuccess ? (
                              <CheckCircle size={14} color="var(--success)" />
                            ) : (
                              <XCircle size={14} color="var(--error)" />
                            )}
                            <span style={{ fontSize: '0.8rem' }}>
                              {log.responseStatusCode || (log.isSuccess ? 'OK' : 'ERR')}
                            </span>
                          </div>
                        </td>
                        <td style={{ fontSize: '0.875rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Clock size={12} color="var(--text-secondary)" />
                            {log.executionTimeMs}
                          </div>
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem' }}
                            onClick={() => openDetailModal(log)}
                            title="View Details"
                          >
                            <Eye size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Showing {((page - 1) * pageSize) + 1} - {Math.min(page * pageSize, total)} of {total} logs
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <span style={{ display: 'flex', alignItems: 'center', padding: '0 1rem', fontSize: '0.875rem' }}>
                Page {page} of {totalPages}
              </span>
              <button
                className="btn btn-secondary"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedLog(null);
        }}
        title="Transaction Details"
        size="xl"
      >
        {selectedLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Summary */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              padding: '1rem',
              backgroundColor: 'var(--background)',
              borderRadius: '0.5rem',
            }}>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Module</div>
                <span className={`badge ${MODULE_COLORS[selectedLog.module] || 'badge-secondary'}`}>
                  {selectedLog.module}
                </span>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Status</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {selectedLog.isSuccess ? (
                    <CheckCircle size={16} color="var(--success)" />
                  ) : (
                    <XCircle size={16} color="var(--error)" />
                  )}
                  <span>{selectedLog.responseStatusCode || (selectedLog.isSuccess ? 'Success' : 'Failed')}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Execution Time</div>
                <div>{selectedLog.executionTimeMs} ms</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>GSTIN</div>
                <div style={{ fontFamily: 'monospace' }}>{selectedLog.gstin || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Timestamp</div>
                <div>{format(new Date(selectedLog.stamp), 'MMM d, yyyy HH:mm:ss')}</div>
              </div>
              {selectedLog.responseFilePath && (
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Response File</div>
                  <div style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{selectedLog.responseFilePath}</div>
                </div>
              )}
            </div>

            {/* URL */}
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Request URL</div>
              <div style={{
                padding: '0.75rem',
                backgroundColor: 'var(--background)',
                borderRadius: '0.375rem',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                wordBreak: 'break-all',
              }}>
                <span style={{ color: 'var(--primary)', fontWeight: 500 }}>{selectedLog.requestMethod}</span>{' '}
                {selectedLog.requestUrl}
              </div>
            </div>

            {/* Request Body */}
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Request Body</div>
              <pre style={{
                padding: '0.75rem',
                backgroundColor: 'var(--background)',
                borderRadius: '0.375rem',
                fontSize: '0.75rem',
                overflow: 'auto',
                maxHeight: '200px',
                margin: 0,
              }}>
                {JSON.stringify(selectedLog.requestBody, null, 2)}
              </pre>
            </div>

            {/* Request Headers */}
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Request Headers</div>
              <pre style={{
                padding: '0.75rem',
                backgroundColor: 'var(--background)',
                borderRadius: '0.375rem',
                fontSize: '0.75rem',
                overflow: 'auto',
                maxHeight: '150px',
                margin: 0,
              }}>
                {JSON.stringify(selectedLog.requestHeaders, null, 2)}
              </pre>
            </div>

            {/* Response Headers */}
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>Response Headers</div>
              <pre style={{
                padding: '0.75rem',
                backgroundColor: 'var(--background)',
                borderRadius: '0.375rem',
                fontSize: '0.75rem',
                overflow: 'auto',
                maxHeight: '150px',
                margin: 0,
              }}>
                {JSON.stringify(selectedLog.responseHeaders, null, 2)}
              </pre>
            </div>

            {/* Error Message */}
            {selectedLog.errorMessage && (
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--error)' }}>
                  Error Message
                </div>
                <div style={{
                  padding: '0.75rem',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '0.375rem',
                  fontSize: '0.8rem',
                  color: 'var(--error)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {selectedLog.errorMessage}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
