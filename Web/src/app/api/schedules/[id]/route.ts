import { NextRequest, NextResponse } from 'next/server';
import { getMasterPool } from '@/lib/db';
import { ApiResponse } from '@/types';
import { parseExpression } from 'cron-parser';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET - Fetch a specific scheduled task
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const pool = getMasterPool();
  const { id: taskId } = await params;

  try {
    const result = await pool.query(
      `SELECT
        st.id,
        st.subscriber_id,
        st.task_name,
        st.task_description,
        st.cron_expression,
        st.task_type,
        st.task_config,
        st.is_active,
        st.start_datetime,
        st.last_from_stamp,
        st.last_to_stamp,
        st.is_initial_sync_complete,
        st.last_run_at,
        st.next_run_at,
        st.created_at,
        st.updated_at,
        s.subscriber_name
      FROM scheduled_tasks st
      JOIN subscribers s ON st.subscriber_id = s.subscriber_id
      WHERE st.id = $1`,
      [taskId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Scheduled task not found' },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    const task = {
      id: row.id,
      subscriberId: row.subscriber_id,
      subscriberName: row.subscriber_name,
      taskName: row.task_name,
      taskDescription: row.task_description,
      cronExpression: row.cron_expression,
      taskType: row.task_type,
      taskConfig: row.task_config,
      isActive: row.is_active,
      startDatetime: row.start_datetime,
      lastFromStamp: row.last_from_stamp,
      lastToStamp: row.last_to_stamp,
      isInitialSyncComplete: row.is_initial_sync_complete,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return NextResponse.json<ApiResponse>({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error('Error fetching scheduled task:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch scheduled task' },
      { status: 500 }
    );
  }
}

// PUT - Update a scheduled task
export async function PUT(
  request: NextRequest,
  { params }: RouteParams
) {
  const pool = getMasterPool();
  const { id: taskId } = await params;

  try {
    const body = await request.json();

    // Build update query dynamically
    const updateFields: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (body.taskName) {
      updateFields.push(`task_name = $${paramIndex++}`);
      values.push(body.taskName);
    }
    if (body.taskDescription !== undefined) {
      updateFields.push(`task_description = $${paramIndex++}`);
      values.push(body.taskDescription);
    }
    if (body.cronExpression) {
      // Validate cron expression
      try {
        const interval = parseExpression(body.cronExpression);
        const nextRunAt = interval.next().toDate();
        updateFields.push(`cron_expression = $${paramIndex++}`);
        values.push(body.cronExpression);
        updateFields.push(`next_run_at = $${paramIndex++}`);
        values.push(nextRunAt);
      } catch {
        return NextResponse.json<ApiResponse>(
          { success: false, error: 'Invalid cron expression' },
          { status: 400 }
        );
      }
    }
    if (body.taskType) {
      const validTaskTypes = ['sync', 'backup', 'report', 'custom', 'export'];
      if (!validTaskTypes.includes(body.taskType)) {
        return NextResponse.json<ApiResponse>(
          { success: false, error: `Invalid task type. Must be one of: ${validTaskTypes.join(', ')}` },
          { status: 400 }
        );
      }
      updateFields.push(`task_type = $${paramIndex++}`);
      values.push(body.taskType);
    }
    if (body.taskConfig) {
      updateFields.push(`task_config = $${paramIndex++}`);
      values.push(JSON.stringify(body.taskConfig));
    }
    if (body.isActive !== undefined) {
      updateFields.push(`is_active = $${paramIndex++}`);
      values.push(body.isActive);
    }
    if (body.startDatetime !== undefined) {
      updateFields.push(`start_datetime = $${paramIndex++}`);
      values.push(body.startDatetime ? new Date(body.startDatetime) : null);
    }

    if (updateFields.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(taskId);

    const result = await pool.query(
      `UPDATE scheduled_tasks
       SET ${updateFields.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Scheduled task not found' },
        { status: 404 }
      );
    }

    const row = result.rows[0];
    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Scheduled task updated successfully',
      data: {
        id: row.id,
        subscriberId: row.subscriber_id,
        taskName: row.task_name,
        taskDescription: row.task_description,
        cronExpression: row.cron_expression,
        taskType: row.task_type,
        taskConfig: row.task_config,
        isActive: row.is_active,
        startDatetime: row.start_datetime,
        lastFromStamp: row.last_from_stamp,
        lastToStamp: row.last_to_stamp,
        isInitialSyncComplete: row.is_initial_sync_complete,
        nextRunAt: row.next_run_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    console.error('Error updating scheduled task:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to update scheduled task' },
      { status: 500 }
    );
  }
}

// DELETE - Delete a scheduled task
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const pool = getMasterPool();
  const { id: taskId } = await params;

  try {
    const result = await pool.query(
      'DELETE FROM scheduled_tasks WHERE id = $1 RETURNING *',
      [taskId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Scheduled task not found' },
        { status: 404 }
      );
    }

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Scheduled task deleted successfully',
      data: { deletedTaskId: taskId },
    });
  } catch (error) {
    console.error('Error deleting scheduled task:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to delete scheduled task' },
      { status: 500 }
    );
  }
}
