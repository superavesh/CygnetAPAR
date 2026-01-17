'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Plus,
  Edit2,
  Trash2,
  Loader2,
  Calendar,
  Play,
  Pause,
  Clock,
  History,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/Modal';
import ScheduleForm from '@/components/ScheduleForm';
import ConfirmDialog from '@/components/ConfirmDialog';
import { CreateScheduledTaskRequest } from '@/types';
import { format, formatDistanceToNow, isPast } from 'date-fns';
import cronParser from 'cron-parser';

interface ScheduledTask {
  id: number;
  subscriberId: string;
  subscriberName: string;
  taskName: string;
  taskDescription: string;
  cronExpression: string;
  taskType: string;
  taskConfig: Record<string, unknown>;
  isActive: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Subscriber {
  subscriberId: string;
  subscriberName: string;
}

const TASK_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  sync: { label: 'Sync', color: 'badge-info' },
  backup: { label: 'Backup', color: 'badge-success' },
  report: { label: 'Report', color: 'badge-warning' },
  export: { label: 'Export', color: 'badge-info' },
  custom: { label: 'Custom', color: 'badge-secondary' },
};

// Helper function to calculate the next run time from cron expression
function getNextRunTime(cronExpression: string, storedNextRunAt: string | null): Date | null {
  try {
    // If we have a stored next run time and it's in the future, use it
    if (storedNextRunAt) {
      const storedDate = new Date(storedNextRunAt);
      if (!isPast(storedDate)) {
        return storedDate;
      }
    }

    // Otherwise, calculate from cron expression
    const interval = cronParser.parseExpression(cronExpression);
    return interval.next().toDate();
  } catch (error) {
    console.error('Error parsing cron expression:', error);
    return null;
  }
}

export default function SchedulesPage() {
  const searchParams = useSearchParams();
  const filterSubscriberId = searchParams.get('subscriberId');

  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLogsModalOpen, setIsLogsModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null);
  const [taskLogs, setTaskLogs] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<number>>(new Set());

  const fetchTasks = async () => {
    try {
      let url = '/api/schedules';
      if (filterSubscriberId) {
        url += `?subscriberId=${filterSubscriberId}`;
      }

      const response = await fetch(url);
      const data = await response.json();

      if (data.success) {
        setTasks(data.data);
      } else {
        toast.error(data.error || 'Failed to fetch schedules');
      }
    } catch (error) {
      console.error('Error fetching schedules:', error);
      toast.error('Failed to fetch schedules');
    } finally {
      setIsLoading(false);
    }
  };

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

  useEffect(() => {
    fetchTasks();
    fetchSubscribers();
  }, [filterSubscriberId]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchTasks();
    setIsRefreshing(false);
    toast.success('Schedules refreshed');
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

  const handleCreate = async (data: CreateScheduledTaskRequest) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Schedule created successfully');
        setIsCreateModalOpen(false);
        fetchTasks();
      } else {
        toast.error(result.error || 'Failed to create schedule');
      }
    } catch (error) {
      console.error('Error creating schedule:', error);
      toast.error('Failed to create schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (data: CreateScheduledTaskRequest) => {
    if (!selectedTask) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/schedules/${selectedTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Schedule updated successfully');
        setIsEditModalOpen(false);
        setSelectedTask(null);
        fetchTasks();
      } else {
        toast.error(result.error || 'Failed to update schedule');
      }
    } catch (error) {
      console.error('Error updating schedule:', error);
      toast.error('Failed to update schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedTask) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/schedules/${selectedTask.id}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Schedule deleted successfully');
        setIsDeleteDialogOpen(false);
        setSelectedTask(null);
        fetchTasks();
      } else {
        toast.error(result.error || 'Failed to delete schedule');
      }
    } catch (error) {
      console.error('Error deleting schedule:', error);
      toast.error('Failed to delete schedule');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (task: ScheduledTask) => {
    try {
      const response = await fetch(`/api/schedules/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !task.isActive }),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`Schedule ${task.isActive ? 'paused' : 'activated'}`);
        fetchTasks();
      } else {
        toast.error(result.error || 'Failed to update schedule');
      }
    } catch (error) {
      console.error('Error toggling schedule:', error);
      toast.error('Failed to update schedule');
    }
  };

  const fetchLogs = async (taskId: number) => {
    setIsLoadingLogs(true);
    try {
      const response = await fetch(`/api/schedules/${taskId}/logs`);
      const data = await response.json();

      if (data.success) {
        setTaskLogs(data.data.logs);
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
      toast.error('Failed to fetch logs');
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const openLogsModal = (task: ScheduledTask) => {
    setSelectedTask(task);
    setIsLogsModalOpen(true);
    fetchLogs(task.id);
  };

  const openEditModal = (task: ScheduledTask) => {
    setSelectedTask(task);
    setIsEditModalOpen(true);
  };

  const openDeleteDialog = (task: ScheduledTask) => {
    setSelectedTask(task);
    setIsDeleteDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
          <Loader2 size={32} className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Scheduled Tasks</h1>
          <p className="page-description">
            {filterSubscriberId
              ? `Showing schedules for: ${subscribers.find(s => s.subscriberId === filterSubscriberId)?.subscriberName || filterSubscriberId}`
              : 'Manage automated tasks for your clients'
            }
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh"
          >
            <RefreshCw size={16} className={isRefreshing ? 'spinner' : ''} />
          </button>
          <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
            <Plus size={16} />
            Add Schedule
          </button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Calendar size={64} className="empty-state-icon" />
            <h3 className="empty-state-title">No scheduled tasks yet</h3>
            <p className="empty-state-description">
              Create automated tasks for your clients like data sync, backups, or reports.
            </p>
            <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
              <Plus size={16} />
              Create Your First Schedule
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Task Name</th>
                  <th>Client</th>
                  <th>Type</th>
                  <th>Schedule</th>
                  <th>Next Run</th>
                  <th>Status</th>
                  <th style={{ width: '180px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{task.taskName}</div>
                      {task.taskDescription && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {task.taskDescription.length > 50
                            ? `${task.taskDescription.substring(0, 50)}...`
                            : task.taskDescription
                          }
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: '0.875rem' }}>{task.subscriberName}</span>
                    </td>
                    <td>
                      <span className={`badge ${TASK_TYPE_LABELS[task.taskType]?.color || 'badge-secondary'}`}>
                        {TASK_TYPE_LABELS[task.taskType]?.label || task.taskType}
                      </span>
                    </td>
                    <td>
                      <code style={{
                        backgroundColor: 'var(--background)',
                        padding: '0.125rem 0.375rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                      }}>
                        {task.cronExpression}
                      </code>
                    </td>
                    <td>
                      {(() => {
                        const nextRun = getNextRunTime(task.cronExpression, task.nextRunAt);
                        if (nextRun) {
                          return (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem' }}>
                                <Clock size={14} color="var(--text-secondary)" />
                                {formatDistanceToNow(nextRun, { addSuffix: true })}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {format(nextRun, 'MMM d, HH:mm')}
                              </div>
                            </div>
                          );
                        }
                        return <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>-</span>;
                      })()}
                    </td>
                    <td>
                      <span className={`badge ${task.isActive ? 'badge-success' : 'badge-secondary'}`}>
                        {task.isActive ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          className={`btn ${task.isActive ? 'btn-secondary' : 'btn-success'}`}
                          style={{ padding: '0.375rem 0.5rem' }}
                          onClick={() => handleToggleActive(task)}
                          title={task.isActive ? 'Pause' : 'Activate'}
                        >
                          {task.isActive ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.375rem 0.5rem' }}
                          onClick={() => openLogsModal(task)}
                          title="View Logs"
                        >
                          <History size={14} />
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.375rem 0.5rem' }}
                          onClick={() => openEditModal(task)}
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.375rem 0.5rem' }}
                          onClick={() => openDeleteDialog(task)}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Schedule"
        size="lg"
      >
        <ScheduleForm
          onSubmit={handleCreate}
          onCancel={() => setIsCreateModalOpen(false)}
          isLoading={isSubmitting}
          subscribers={subscribers}
          mode="create"
          initialData={filterSubscriberId ? { subscriberId: filterSubscriberId } : undefined}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedTask(null);
        }}
        title="Edit Schedule"
        size="lg"
      >
        {selectedTask && (
          <ScheduleForm
            onSubmit={handleUpdate}
            onCancel={() => {
              setIsEditModalOpen(false);
              setSelectedTask(null);
            }}
            isLoading={isSubmitting}
            subscribers={subscribers}
            mode="edit"
            initialData={{
              subscriberId: selectedTask.subscriberId,
              taskName: selectedTask.taskName,
              taskDescription: selectedTask.taskDescription,
              cronExpression: selectedTask.cronExpression,
              taskType: selectedTask.taskType as 'sync' | 'backup' | 'report' | 'custom',
              taskConfig: selectedTask.taskConfig,
            }}
          />
        )}
      </Modal>

      {/* Logs Modal */}
      <Modal
        isOpen={isLogsModalOpen}
        onClose={() => {
          setIsLogsModalOpen(false);
          setSelectedTask(null);
          setTaskLogs([]);
          setExpandedLogIds(new Set());
        }}
        title={`Execution Logs: ${selectedTask?.taskName}`}
        size="xl"
      >
        {isLoadingLogs ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <Loader2 size={24} className="spinner" />
          </div>
        ) : taskLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
            No execution logs yet
          </div>
        ) : (
          <div style={{ maxHeight: '500px', overflow: 'auto' }}>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: '180px' }}>Started At</th>
                  <th style={{ width: '100px' }}>Status</th>
                  <th style={{ width: '100px' }}>Duration</th>
                  <th>Details / Error</th>
                </tr>
              </thead>
              <tbody>
                {taskLogs.map((log) => {
                  const isExpanded = expandedLogIds.has(log.id);
                  const errorMsg = log.errorMessage || '';
                  const hasLongError = errorMsg.length > 100;
                  const displayError = hasLongError && !isExpanded
                    ? errorMsg.substring(0, 100) + '...'
                    : errorMsg;

                  // Parse execution details
                  const details = log.executionDetails || {};
                  const hasDetails = Object.keys(details).length > 0;

                  return (
                    <tr key={log.id} style={{ verticalAlign: 'top' }}>
                      <td style={{ fontSize: '0.875rem' }}>
                        {format(new Date(log.startedAt), 'MMM d, yyyy HH:mm:ss')}
                        {log.completedAt && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Completed: {format(new Date(log.completedAt), 'HH:mm:ss')}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${
                          log.status === 'success' ? 'badge-success' :
                          log.status === 'failed' ? 'badge-error' :
                          'badge-warning'
                        }`}>
                          {log.status}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.875rem' }}>
                        {log.completedAt
                          ? `${Math.round((new Date(log.completedAt).getTime() - new Date(log.startedAt).getTime()) / 1000)}s`
                          : 'Running...'
                        }
                      </td>
                      <td style={{ fontSize: '0.8rem' }}>
                        {/* Error Message */}
                        {errorMsg && (
                          <div style={{
                            backgroundColor: '#fef2f2',
                            border: '1px solid #fecaca',
                            borderRadius: '0.375rem',
                            padding: '0.5rem',
                            marginBottom: hasDetails ? '0.5rem' : 0,
                            color: 'var(--error)',
                            wordBreak: 'break-word',
                          }}>
                            <div style={{ fontWeight: 500, marginBottom: '0.25rem' }}>Error:</div>
                            <div style={{ whiteSpace: isExpanded ? 'pre-wrap' : 'normal' }}>
                              {displayError}
                            </div>
                            {hasLongError && (
                              <button
                                onClick={() => toggleLogExpand(log.id)}
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  color: 'var(--primary)',
                                  cursor: 'pointer',
                                  padding: '0.25rem 0',
                                  fontSize: '0.75rem',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  marginTop: '0.25rem',
                                }}
                              >
                                {isExpanded ? (
                                  <>
                                    <ChevronUp size={12} /> Show less
                                  </>
                                ) : (
                                  <>
                                    <ChevronDown size={12} /> Show more
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        )}

                        {/* Execution Details */}
                        {hasDetails && (
                          <div style={{
                            backgroundColor: '#f0f9ff',
                            border: '1px solid #bae6fd',
                            borderRadius: '0.375rem',
                            padding: '0.5rem',
                            color: 'var(--text-secondary)',
                          }}>
                            <div style={{ fontWeight: 500, marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                              Details:
                            </div>
                            {details.total_records !== undefined && (
                              <div>Records: {details.total_records}</div>
                            )}
                            {details.files_created && details.files_created.length > 0 && (
                              <div>Files: {details.files_created.length}</div>
                            )}
                            {details.from_stamp && (
                              <div>From: {details.from_stamp}</div>
                            )}
                            {details.to_stamp && (
                              <div>To: {details.to_stamp}</div>
                            )}
                          </div>
                        )}

                        {/* No error and no details */}
                        {!errorMsg && !hasDetails && (
                          <span style={{ color: 'var(--text-secondary)' }}>-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setSelectedTask(null);
        }}
        onConfirm={handleDelete}
        title="Delete Schedule"
        message={`Are you sure you want to delete the schedule "${selectedTask?.taskName}"?`}
        confirmText="Delete"
        isLoading={isSubmitting}
        variant="danger"
      />
    </div>
  );
}
