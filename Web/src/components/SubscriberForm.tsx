'use client';

import { useState } from 'react';
import { CreateSubscriberRequest } from '@/types';
import { Loader2 } from 'lucide-react';

interface SubscriberFormProps {
  onSubmit: (data: CreateSubscriberRequest) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  initialData?: Partial<CreateSubscriberRequest>;
  mode?: 'create' | 'edit';
}

export default function SubscriberForm({
  onSubmit,
  onCancel,
  isLoading = false,
  initialData = {},
  mode = 'create',
}: SubscriberFormProps) {
  const [formData, setFormData] = useState<CreateSubscriberRequest>({
    subscriberName: initialData.subscriberName || '',
    subscriberId: initialData.subscriberId || '',
    subscriberURL: initialData.subscriberURL || '',
    subscriberUsername: initialData.subscriberUsername || '',
    subscriberPassword: initialData.subscriberPassword || '',
    subscriberAuthToken: initialData.subscriberAuthToken || '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.subscriberName.trim()) {
      newErrors.subscriberName = 'Subscriber name is required';
    }

    if (!formData.subscriberId.trim()) {
      newErrors.subscriberId = 'Subscriber ID is required';
    } else if (!/^[a-zA-Z0-9_-]+$/.test(formData.subscriberId)) {
      newErrors.subscriberId = 'Subscriber ID can only contain letters, numbers, underscores, and hyphens';
    }

    if (!formData.subscriberURL.trim()) {
      newErrors.subscriberURL = 'Subscriber URL is required';
    } else {
      try {
        new URL(formData.subscriberURL);
      } catch {
        newErrors.subscriberURL = 'Please enter a valid URL';
      }
    }

    if (!formData.subscriberUsername.trim()) {
      newErrors.subscriberUsername = 'Username is required';
    }

    if (mode === 'create' && !formData.subscriberPassword.trim()) {
      newErrors.subscriberPassword = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    await onSubmit(formData);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Clear error when user starts typing
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="subscriberName" className="form-label">
          Subscriber Name *
        </label>
        <input
          type="text"
          id="subscriberName"
          name="subscriberName"
          className="form-input"
          value={formData.subscriberName}
          onChange={handleChange}
          placeholder="Enter subscriber name"
          disabled={isLoading}
        />
        {errors.subscriberName && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.subscriberName}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="subscriberId" className="form-label">
          Subscriber ID *
        </label>
        <input
          type="text"
          id="subscriberId"
          name="subscriberId"
          className="form-input"
          value={formData.subscriberId}
          onChange={handleChange}
          placeholder="Enter unique subscriber ID (e.g., client_001)"
          disabled={isLoading || mode === 'edit'}
        />
        {errors.subscriberId && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.subscriberId}
          </p>
        )}
        {mode === 'create' && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            This will be used to create the tenant database (Tenant_subscriberId)
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="subscriberURL" className="form-label">
          Subscriber URL *
        </label>
        <input
          type="url"
          id="subscriberURL"
          name="subscriberURL"
          className="form-input"
          value={formData.subscriberURL}
          onChange={handleChange}
          placeholder="https://example.com"
          disabled={isLoading}
        />
        {errors.subscriberURL && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.subscriberURL}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="subscriberUsername" className="form-label">
          Username *
        </label>
        <input
          type="text"
          id="subscriberUsername"
          name="subscriberUsername"
          className="form-input"
          value={formData.subscriberUsername}
          onChange={handleChange}
          placeholder="Enter username"
          disabled={isLoading}
        />
        {errors.subscriberUsername && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.subscriberUsername}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="subscriberPassword" className="form-label">
          Password {mode === 'create' ? '*' : '(leave blank to keep unchanged)'}
        </label>
        <input
          type="password"
          id="subscriberPassword"
          name="subscriberPassword"
          className="form-input"
          value={formData.subscriberPassword}
          onChange={handleChange}
          placeholder={mode === 'create' ? 'Enter password' : 'Enter new password (optional)'}
          disabled={isLoading}
        />
        {errors.subscriberPassword && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            {errors.subscriberPassword}
          </p>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="subscriberAuthToken" className="form-label">
          Auth Token (optional)
        </label>
        <input
          type="text"
          id="subscriberAuthToken"
          name="subscriberAuthToken"
          className="form-input"
          value={formData.subscriberAuthToken}
          onChange={handleChange}
          placeholder="Enter auth token or leave blank to auto-generate"
          disabled={isLoading}
        />
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
          If left blank, a unique token will be generated automatically
        </p>
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
            mode === 'create' ? 'Create Client' : 'Update Client'
          )}
        </button>
      </div>
    </form>
  );
}
