import { NextRequest, NextResponse } from 'next/server';
import { getMasterPool } from '@/lib/db';
import { CreateScheduledTaskRequest, ApiResponse } from '@/types';
import { parseExpression } from 'cron-parser';

// GET - Fetch all scheduled tasks or filter by subscriberId
export async function GET(request: NextRequest) {
  const pool = getMasterPool();
  const { searchParams } = new URL(request.url);
  const subscriberId = searchParams.get('subscriberId');

  try {
    let query = `
      SELECT
        st.id,
        st.subscriber_id,
        st.task_name,
        st.task_description,
        st.cron_expression,
        st.task_type,
        st.task_config,
        st.is_active,
        st.last_run_at,
        st.next_run_at,
        st.created_at,
        st.updated_at,
        s.subscriber_name
      FROM scheduled_tasks st
      JOIN subscribers s ON st.subscriber_id = s.subscriber_id
    `;
    const values: string[] = [];

    if (subscriberId) {
      query += ' WHERE st.subscriber_id = $1';
      values.push(subscriberId);
    }

    query += ' ORDER BY st.created_at DESC';

    const result = await pool.query(query, values);

    const tasks = result.rows.map(row => ({
      id: row.id,
      subscriberId: row.subscriber_id,
      subscriberName: row.subscriber_name,
      taskName: row.task_name,
      taskDescription: row.task_description,
      cronExpression: row.cron_expression,
      taskType: row.task_type,
      taskConfig: row.task_config,
      isActive: row.is_active,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return NextResponse.json<ApiResponse>({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error('Error fetching scheduled tasks:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to fetch scheduled tasks' },
      { status: 500 }
    );
  }
}

// POST - Create a new scheduled task
export async function POST(request: NextRequest) {
  const pool = getMasterPool();

  try {
    const body: CreateScheduledTaskRequest = await request.json();

    // Validate required fields
    const requiredFields = ['subscriberId', 'taskName', 'cronExpression', 'taskType'];
    for (const field of requiredFields) {
      if (!body[field as keyof CreateScheduledTaskRequest]) {
        return NextResponse.json<ApiResponse>(
          { success: false, error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate cron expression
    let nextRunAt: Date;
    try {
      const interval = parseExpression(body.cronExpression);
      nextRunAt = interval.next().toDate();
    } catch {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Invalid cron expression' },
        { status: 400 }
      );
    }

    // Validate task type
    const validTaskTypes = ['sync', 'backup', 'report', 'custom'];
    if (!validTaskTypes.includes(body.taskType)) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: `Invalid task type. Must be one of: ${validTaskTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if subscriber exists
    const subscriberResult = await pool.query(
      'SELECT id FROM subscribers WHERE subscriber_id = $1',
      [body.subscriberId]
    );

    if (subscriberResult.rows.length === 0) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: 'Subscriber not found' },
        { status: 404 }
      );
    }

    // Insert scheduled task
    const result = await pool.query(
      `INSERT INTO scheduled_tasks
       (subscriber_id, task_name, task_description, cron_expression, task_type, task_config, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        body.subscriberId,
        body.taskName,
        body.taskDescription || '',
        body.cronExpression,
        body.taskType,
        JSON.stringify(body.taskConfig || {}),
        nextRunAt,
      ]
    );

    const row = result.rows[0];

    return NextResponse.json<ApiResponse>({
      success: true,
      message: 'Scheduled task created successfully',
      data: {
        id: row.id,
        subscriberId: row.subscriber_id,
        taskName: row.task_name,
        taskDescription: row.task_description,
        cronExpression: row.cron_expression,
        taskType: row.task_type,
        taskConfig: row.task_config,
        isActive: row.is_active,
        nextRunAt: row.next_run_at,
        createdAt: row.created_at,
      },
    });
  } catch (error) {
    console.error('Error creating scheduled task:', error);
    return NextResponse.json<ApiResponse>(
      { success: false, error: 'Failed to create scheduled task' },
      { status: 500 }
    );
  }
}
