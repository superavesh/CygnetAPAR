export interface Subscriber {
  id: number;
  subscriberName: string;
  subscriberId: string;
  subscriberURL: string;
  subscriberUsername: string;
  subscriberPassword: string;
  subscriberAuthToken: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Tenant {
  id: number;
  subscriberId: string;
  databaseName: string;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduledTask {
  id: number;
  subscriberId: string;
  taskName: string;
  taskDescription: string;
  cronExpression: string;
  taskType: 'sync' | 'backup' | 'report' | 'custom';
  taskConfig: Record<string, unknown>;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskExecutionLog {
  id: number;
  taskId: number;
  subscriberId: string;
  status: 'running' | 'success' | 'failed';
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
  executionDetails: Record<string, unknown>;
}

export interface CreateSubscriberRequest {
  subscriberName: string;
  subscriberId: string;
  subscriberURL: string;
  subscriberUsername: string;
  subscriberPassword: string;
  subscriberAuthToken: string;
}

export interface CreateScheduledTaskRequest {
  subscriberId: string;
  taskName: string;
  taskDescription: string;
  cronExpression: string;
  taskType: 'sync' | 'backup' | 'report' | 'custom';
  taskConfig?: Record<string, unknown>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
