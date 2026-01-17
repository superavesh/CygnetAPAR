'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  Loader2,
  Users,
  ExternalLink,
  Database,
  Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';
import Modal from '@/components/Modal';
import SubscriberForm from '@/components/SubscriberForm';
import ConfirmDialog from '@/components/ConfirmDialog';
import { CreateSubscriberRequest } from '@/types';
import { format } from 'date-fns';
import Link from 'next/link';

interface Subscriber {
  id: number;
  subscriberName: string;
  subscriberId: string;
  subscriberURL: string;
  subscriberUsername: string;
  subscriberAuthToken: string;
  tenantActive: boolean;
  databaseName: string;
  createdAt: string;
  updatedAt: string;
}

export default function SubscribersPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedSubscriber, setSelectedSubscriber] = useState<Subscriber | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchSubscribers = async () => {
    try {
      const response = await fetch('/api/subscribers');
      const data = await response.json();

      if (data.success) {
        setSubscribers(data.data);
      } else {
        toast.error(data.error || 'Failed to fetch clients');
      }
    } catch (error) {
      console.error('Error fetching subscribers:', error);
      toast.error('Failed to fetch clients');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscribers();
  }, []);

  const handleCreate = async (data: CreateSubscriberRequest) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/subscribers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Client created successfully with tenant database');
        setIsCreateModalOpen(false);
        fetchSubscribers();
      } else {
        toast.error(result.error || 'Failed to create client');
      }
    } catch (error) {
      console.error('Error creating subscriber:', error);
      toast.error('Failed to create client');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (data: CreateSubscriberRequest) => {
    if (!selectedSubscriber) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/subscribers/${selectedSubscriber.subscriberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Client updated successfully');
        setIsEditModalOpen(false);
        setSelectedSubscriber(null);
        fetchSubscribers();
      } else {
        toast.error(result.error || 'Failed to update client');
      }
    } catch (error) {
      console.error('Error updating subscriber:', error);
      toast.error('Failed to update client');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedSubscriber) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/subscribers/${selectedSubscriber.subscriberId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        toast.success('Client deleted successfully');
        setIsDeleteDialogOpen(false);
        setSelectedSubscriber(null);
        fetchSubscribers();
      } else {
        toast.error(result.error || 'Failed to delete client');
      }
    } catch (error) {
      console.error('Error deleting subscriber:', error);
      toast.error('Failed to delete client');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (subscriber: Subscriber) => {
    setSelectedSubscriber(subscriber);
    setIsEditModalOpen(true);
  };

  const openDeleteDialog = (subscriber: Subscriber) => {
    setSelectedSubscriber(subscriber);
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
          <h1 className="page-title">Clients</h1>
          <p className="page-description">
            Manage your clients and their tenant databases
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
          <Plus size={16} />
          Add Client
        </button>
      </div>

      {subscribers.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <Users size={64} className="empty-state-icon" />
            <h3 className="empty-state-title">No clients yet</h3>
            <p className="empty-state-description">
              Get started by adding your first client. A dedicated tenant database will be created automatically.
            </p>
            <button className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
              <Plus size={16} />
              Add Your First Client
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>ID</th>
                  <th>URL</th>
                  <th>Database</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ width: '150px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscribers.map((subscriber) => (
                  <tr key={subscriber.id}>
                    <td>
                      <div style={{ fontWeight: 500 }}>{subscriber.subscriberName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {subscriber.subscriberUsername}
                      </div>
                    </td>
                    <td>
                      <code style={{
                        backgroundColor: 'var(--background)',
                        padding: '0.125rem 0.375rem',
                        borderRadius: '0.25rem',
                        fontSize: '0.75rem',
                      }}>
                        {subscriber.subscriberId}
                      </code>
                    </td>
                    <td>
                      <a
                        href={subscriber.subscriberURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          color: 'var(--primary)',
                          fontSize: '0.875rem',
                        }}
                      >
                        {new URL(subscriber.subscriberURL).hostname}
                        <ExternalLink size={12} />
                      </a>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Database size={14} color="var(--text-secondary)" />
                        <span style={{ fontSize: '0.875rem' }}>{subscriber.databaseName}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${subscriber.tenantActive ? 'badge-success' : 'badge-error'}`}>
                        {subscriber.tenantActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      {format(new Date(subscriber.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <Link href={`/schedules?subscriberId=${subscriber.subscriberId}`}>
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.375rem 0.5rem' }}
                            title="View Schedules"
                          >
                            <Calendar size={14} />
                          </button>
                        </Link>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.375rem 0.5rem' }}
                          onClick={() => openEditModal(subscriber)}
                          title="Edit"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '0.375rem 0.5rem' }}
                          onClick={() => openDeleteDialog(subscriber)}
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
        title="Add New Client"
        size="lg"
      >
        <SubscriberForm
          onSubmit={handleCreate}
          onCancel={() => setIsCreateModalOpen(false)}
          isLoading={isSubmitting}
          mode="create"
        />
      </Modal>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedSubscriber(null);
        }}
        title="Edit Client"
        size="lg"
      >
        {selectedSubscriber && (
          <SubscriberForm
            onSubmit={handleUpdate}
            onCancel={() => {
              setIsEditModalOpen(false);
              setSelectedSubscriber(null);
            }}
            isLoading={isSubmitting}
            mode="edit"
            initialData={{
              subscriberName: selectedSubscriber.subscriberName,
              subscriberId: selectedSubscriber.subscriberId,
              subscriberURL: selectedSubscriber.subscriberURL,
              subscriberUsername: selectedSubscriber.subscriberUsername,
              subscriberAuthToken: selectedSubscriber.subscriberAuthToken,
            }}
          />
        )}
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false);
          setSelectedSubscriber(null);
        }}
        onConfirm={handleDelete}
        title="Delete Client"
        message={`Are you sure you want to delete "${selectedSubscriber?.subscriberName}"?`}
        confirmText="Delete"
        isLoading={isSubmitting}
        variant="danger"
      />
    </div>
  );
}
