'use client';

import { useState, useEffect } from 'react';
import { Users, Database, Calendar, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

interface DashboardStats {
  initialized: boolean;
  stats?: {
    subscribers: number;
    tenants: number;
    scheduledTasks: number;
  };
  error?: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/init');
      const data = await response.json();
      setStats(data.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
      toast.error('Failed to fetch dashboard stats');
    } finally {
      setIsLoading(false);
    }
  };

  const initializeDatabase = async () => {
    setIsInitializing(true);
    try {
      const response = await fetch('/api/init', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        toast.success('Database initialized successfully');
        fetchStats();
      } else {
        toast.error(data.error || 'Failed to initialize database');
      }
    } catch (error) {
      console.error('Error initializing database:', error);
      toast.error('Failed to initialize database');
    } finally {
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

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
          <h1 className="page-title">Dashboard</h1>
          <p className="page-description">
            Manage your clients, tenant databases, and scheduled tasks
          </p>
        </div>
      </div>

      {/* Database Status */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="card-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              {stats?.initialized ? (
                <>
                  <div style={{
                    width: '3rem',
                    height: '3rem',
                    borderRadius: '50%',
                    backgroundColor: '#dcfce7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <CheckCircle size={24} color="#16a34a" />
                  </div>
                  <div>
                    <h3 style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Database Connected</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      Master database is initialized and ready
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div style={{
                    width: '3rem',
                    height: '3rem',
                    borderRadius: '50%',
                    backgroundColor: '#fef3c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <AlertCircle size={24} color="#d97706" />
                  </div>
                  <div>
                    <h3 style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Database Not Initialized</h3>
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      {stats?.error || 'Click the button to initialize the master database'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {!stats?.initialized && (
              <button
                className="btn btn-primary"
                onClick={initializeDatabase}
                disabled={isInitializing}
              >
                {isInitializing ? (
                  <>
                    <Loader2 size={16} className="spinner" />
                    Initializing...
                  </>
                ) : (
                  'Initialize Database'
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      {stats?.initialized && stats.stats && (
        <div className="stats-grid">
          <Link href="/subscribers" style={{ textDecoration: 'none' }}>
            <div className="stat-card" style={{ cursor: 'pointer', transition: 'transform 0.2s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  width: '3rem',
                  height: '3rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#dbeafe',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Users size={24} color="#2563eb" />
                </div>
                <div>
                  <p className="stat-label">Total Clients</p>
                  <p className="stat-value">{stats.stats.subscribers}</p>
                </div>
              </div>
            </div>
          </Link>

          <div className="stat-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: '3rem',
                height: '3rem',
                borderRadius: '0.5rem',
                backgroundColor: '#dcfce7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Database size={24} color="#16a34a" />
              </div>
              <div>
                <p className="stat-label">Tenant Databases</p>
                <p className="stat-value">{stats.stats.tenants}</p>
              </div>
            </div>
          </div>

          <Link href="/schedules" style={{ textDecoration: 'none' }}>
            <div className="stat-card" style={{ cursor: 'pointer', transition: 'transform 0.2s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{
                  width: '3rem',
                  height: '3rem',
                  borderRadius: '0.5rem',
                  backgroundColor: '#fef3c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Calendar size={24} color="#d97706" />
                </div>
                <div>
                  <p className="stat-label">Scheduled Tasks</p>
                  <p className="stat-value">{stats.stats.scheduledTasks}</p>
                </div>
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* Quick Actions */}
      {stats?.initialized && (
        <div className="card">
          <div className="card-header">
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>Quick Actions</h2>
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
              <Link href="/subscribers">
                <button className="btn btn-primary">
                  <Users size={16} />
                  Add New Client
                </button>
              </Link>
              <Link href="/schedules">
                <button className="btn btn-secondary">
                  <Calendar size={16} />
                  Create Schedule
                </button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
