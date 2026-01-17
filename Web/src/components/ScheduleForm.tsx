'use client';

import { useState, useEffect } from 'react';
import { CreateScheduledTaskRequest } from '@/types';
import { Loader2, Info } from 'lucide-react';

interface ScheduleFormProps {
  onSubmit: (data: CreateScheduledTaskRequest) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  subscribers: Array<{ subscriberId: string; subscriberName: string }>;
  initialData?: Partial<CreateScheduledTaskRequest>;
  mode?: 'create' | 'edit';
}

const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every 5 minutes', value: '*/5 * * * *' },
  { label: 'Every 15 minutes', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every day at midnight', value: '0 0 * * *' },
  { label: 'Every day at 6 AM', value: '0 6 * * *' },
  { label: 'Every Monday at 9 AM', value: '0 9 * * 1' },
  { label: 'Every month on 1st', value: '0 0 1 * *' },
  { label: 'Custom', value: 'custom' },
];

const TASK_TYPES = [
  { value: 'sync', label: 'Data Sync', description: 'Synchronize data between systems' },
  { value: 'backup', label: 'Backup', description: 'Create backups of data' },
  { value: 'report', label: 'Report', description: 'Generate scheduled reports' },
  { value: 'export', label: 'Export', description: 'Export data from API to files' },
  { value: 'custom', label: 'Custom', description: 'Custom task execution' },
];

export default function ScheduleForm({
  onSubmit,
  onCancel,
  isLoading = false,
  subscribers,
  initialData = {},
  mode = 'create',
}: ScheduleFormProps) {
  const [formData, setFormData] = useState<CreateScheduledTaskRequest>({
    subscriberId: initialData.subscriberId || '',
    taskName: initialData.taskName || '',
    taskDescription: initialData.taskDescription || '',
    cronExpression: initialData.cronExpression || '0 * * * *',
    taskType: initialData.taskType || 'sync',
    taskConfig: initialData.taskConfig || {},
    startDatetime: initialData.startDatetime || '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cronPreset, setCronPreset] = useState<string>('0 * * * *');
  const [isCustomCron, setIsCustomCron] = useState(false);

  useEffect(() => {
    // Check if the initial cron expression matches any preset
    const matchingPreset = CRON_PRESETS.find(p => p.value === initialData.cronExpression);
    if (matchingPreset && matchingPreset.value !== 'custom') {
      setCronPreset(matchingPreset.value);
      setIsCustomCron(false);
    } else if (initialData.cronExpression) {
      setCronPreset('custom');
      setIsCustomCron(true);
    }
  }, [initialData.cronExpression]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.subscriberId) {
      newErrors.subscriberId = 'Please select a client';
    }

    if (!formData.taskName.trim()) {
      newErrors.taskName = 'Task name is required';
    }

    if (!formData.cronExpression.trim()) {
      newErrors.cronExpression = 'Cron expression is required';
    } else {
      // Basic cron validation (5 or 6 parts)
      const parts = formData.cronExpression.trim().split(/\s+/);
      if (parts.length < 5 || parts.length > 6) {
        newErrors.cronExpression = 'Invalid cron expression format';
      }
    }

    if (!formData.taskType) {
      newErrors.taskType = 'Please select a task type';
    }

    // Validate startDatetime for export tasks
    if (formData.taskType === 'export' && !formData.startDatetime) {
      newErrors.startDatetime = 'Start datetime is required for export tasks';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    await onSubmit(formData);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  const handleCronPresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setCronPreset(value);

    if (value === 'custom') {
      setIsCustomCron(true);
    } else {
      setIsCustomCron(false);
      setFormData((prev) => ({ ...prev, cronExpression: value }));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="subscriberId" className="form-label">
          Client *
        </label>
        <select
          id="subscriberId"
          name="subscriberId"
          className="form-select"
          value={formData.subscriberId}
          onChange={handleChange}
          disabled={isLoading || mode === 'edit'}
        >
          <option value="">Select a client</option>
          {subscribers.map((sub) => (
            <option key={sub.subscriberId} value={sub.subscriberId}>
              {sub.subscriberName} ({sub.subscriberId})
            </option>
          ))}
        </select>
        {errors.subscriberId && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.subscriberId}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="taskName" className="form-label">
          Task Name *
        </label>
        <input
          type="text"
          id="taskName"
          name="taskName"
          className="form-input"
          value={formData.taskName}
          onChange={handleChange}
          placeholder="Enter task name"
          disabled={isLoading}
        />
        {errors.taskName && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.taskName}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="taskDescription" className="form-label">
          Description
        </label>
        <textarea
          id="taskDescription"
          name="taskDescription"
          className="form-input"
          value={formData.taskDescription}
          onChange={handleChange}
          placeholder="Enter task description"
          rows={3}
          disabled={isLoading}
          style={{ resize: 'vertical' }}
        />
      </div>

      <div className="form-group">
        <label htmlFor="taskType" className="form-label">
          Task Type *
        </label>
        <select
          id="taskType"
          name="taskType"
          className="form-select"
          value={formData.taskType}
          onChange={handleChange}
          disabled={isLoading}
        >
          {TASK_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label} - {type.description}
            </option>
          ))}
        </select>
        {errors.taskType && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.taskType}
          </p>
        )}
      </div>

      {formData.taskType === 'export' && (
        <div className="form-group">
          <label className="form-label">
            Start DateTime *
          </label>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="startDate" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                From
              </label>
              <input
                type="date"
                id="startDate"
                className="form-input"
                value={formData.startDatetime ? formData.startDatetime.split('T')[0] : ''}
                onChange={(e) => {
                  const date = e.target.value;
                  const time = formData.startDatetime?.split('T')[1] || '00:00';
                  setFormData(prev => ({ ...prev, startDatetime: date ? `${date}T${time}` : '' }));
                  if (errors.startDatetime) {
                    setErrors(prev => ({ ...prev, startDatetime: '' }));
                  }
                }}
                disabled={isLoading}
              />
            </div>
            <div style={{ width: '120px' }}>
              <label htmlFor="startTime" style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                Time
              </label>
              <input
                type="time"
                id="startTime"
                className="form-input"
                value={formData.startDatetime ? formData.startDatetime.split('T')[1]?.substring(0, 5) || '00:00' : '00:00'}
                onChange={(e) => {
                  const time = e.target.value;
                  const date = formData.startDatetime?.split('T')[0] || '';
                  if (date) {
                    setFormData(prev => ({ ...prev, startDatetime: `${date}T${time}` }));
                  }
                }}
                disabled={isLoading || !formData.startDatetime?.split('T')[0]}
              />
            </div>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem',
            marginTop: '0.5rem',
            padding: '0.75rem',
            backgroundColor: '#fef3c7',
            borderRadius: '0.375rem',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
          }}>
            <Info size={14} style={{ flexShrink: 0, marginTop: '0.125rem' }} />
            <div>
              <strong>Start DateTime:</strong> The scheduler will first fetch all data from this datetime until now (initial sync), then continue fetching incrementally based on the schedule.
            </div>
          </div>
          {errors.startDatetime && (
            <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              {errors.startDatetime}
            </p>
          )}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="cronPreset" className="form-label">
          Schedule *
        </label>
        <select
          id="cronPreset"
          className="form-select"
          value={cronPreset}
          onChange={handleCronPresetChange}
          disabled={isLoading}
          style={{ marginBottom: '0.5rem' }}
        >
          {CRON_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>

        {isCustomCron && (
          <input
            type="text"
            id="cronExpression"
            name="cronExpression"
            className="form-input"
            value={formData.cronExpression}
            onChange={handleChange}
            placeholder="* * * * * (minute hour day month weekday)"
            disabled={isLoading}
          />
        )}

        {errors.cronExpression && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.cronExpression}
          </p>
        )}

        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.5rem',
          marginTop: '0.5rem',
          padding: '0.75rem',
          backgroundColor: '#f0f9ff',
          borderRadius: '0.375rem',
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
        }}>
          <Info size={14} style={{ flexShrink: 0, marginTop: '0.125rem' }} />
          <div>
            <strong>Cron Format:</strong> minute (0-59) hour (0-23) day (1-31) month (1-12) weekday (0-7)
            <br />
            <strong>Examples:</strong> <code>0 9 * * 1-5</code> (9 AM Mon-Fri), <code>*/30 * * * *</code> (every 30 min)
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 size={16} className="spinner" />
              {mode === 'create' ? 'Creating...' : 'Updating...'}
            </>
          ) : (
            mode === 'create' ? 'Create Schedule' : 'Update Schedule'
          )}
        </button>
      </div>
    </form>
  );
}
