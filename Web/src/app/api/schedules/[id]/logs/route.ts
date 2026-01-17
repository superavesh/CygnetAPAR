import { NextRequest, NextResponse } from 'next/server';
import { getMasterPool } from '@/lib/db';
import { ApiResponse } from '@/types';

// GET - Fetch execution logs for a specific task
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getMasterPool();
  const taskId = params.id;
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    // Verify task exists
    const taskResult = await pool.query(
      'SELECT id FROM scheduled_tasks WHERE id = $1',
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Scheduled task not found' },
        { status: 404 }
      );
    }

    // Fetch logs
    const result = await pool.query(
      `SELECT
        id,
        task_id,
        subscriber_id,
        status,
        started_at,
        completed_at,
        error_message,
        execution_details
      FROM task_execution_logs
      WHERE task_id = $1
      ORDER BY started_at DESC
      LIMIT $2 OFFSET $3`,
      [taskId, limit, offset]
    );

    // Get total count
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM task_execution_logs WHERE task_id = $1',
      [taskId]
    );

    const logs = result.rows.map(row => ({
      id: row.id,
      taskId: row.task_id,
      subscriberId: row.subscriber_id,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      errorMessage: row.error_message,
      executionDetails: row.execution_details,
    }));

    return NextResponse.json<ApiResponse>({
      success: true,
      data: {
        logs,
        pagination: {
          total: parseInt(countResult.rows[0].total),
          limit,
          offset,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching task execution logs:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch execution logs' },
      { status: 500 }
    );
  }
}
