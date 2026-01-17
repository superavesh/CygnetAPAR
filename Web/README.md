# APAR Client Manager

A multi-tenant client management system built with Next.js and PostgreSQL. This application allows you to manage clients (subscribers), automatically create dedicated tenant databases for each client, and schedule automated tasks.

## Features

- **Client Management**: Add, edit, and delete clients with their details
- **Multi-tenant Architecture**: Each client gets a dedicated PostgreSQL database (`Tenant_{subscriberId}`)
- **Master Database**: Central database storing all subscriber information and tenant connection details
- **Task Scheduling**: Schedule automated tasks (sync, backup, report, custom) with cron expressions
- **Clean UI**: Modern, responsive interface built with Tailwind CSS

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm or yarn

## Database Architecture

### Master Database (`MasterDatabase`)

Contains the following tables:

1. **subscribers**: Client information
   - `subscriber_name`, `subscriber_id`, `subscriber_url`
   - `subscriber_username`, `subscriber_password`, `subscriber_auth_token`

2. **tenants**: Database connection details for each tenant
   - `subscriber_id`, `database_name`, `db_host`, `db_port`
   - `db_user`, `db_password`, `is_active`

3. **scheduled_tasks**: Task scheduling configuration
   - `subscriber_id`, `task_name`, `task_description`
   - `cron_expression`, `task_type`, `task_config`
   - `is_active`, `last_run_at`, `next_run_at`

4. **task_execution_logs**: Task execution history
   - `task_id`, `subscriber_id`, `status`
   - `started_at`, `completed_at`, `error_message`

### Tenant Databases (`Tenant_{subscriberId}`)

Each tenant database is created automatically when a new client is added and contains:
- `tenant_info`: Basic tenant information
- `tenant_settings`: Key-value settings storage
- `tenant_logs`: Activity logs

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
cd D:\Avesh\APARChatBot\Web
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and update with your PostgreSQL credentials:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Master Database Configuration
MASTER_DB_HOST=localhost
MASTER_DB_PORT=5432
MASTER_DB_NAME=MasterDatabase
MASTER_DB_USER=postgres
MASTER_DB_PASSWORD=your_password_here

# PostgreSQL Admin credentials for creating tenant databases
PG_ADMIN_USER=postgres
PG_ADMIN_PASSWORD=your_admin_password_here

# Application Settings
NEXT_PUBLIC_APP_NAME=APAR Client Manager
```

### 3. Initialize the Database

You can initialize the database in two ways:

**Option A: Using the web interface**
1. Start the development server: `npm run dev`
2. Open http://localhost:3000
3. Click "Initialize Database" on the dashboard

**Option B: Using the command line**
```bash
npm run db:init
```

### 4. Start the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Adding a New Client

1. Navigate to **Clients** page
2. Click **Add Client**
3. Fill in the required fields:
   - **Subscriber Name**: Display name for the client
   - **Subscriber ID**: Unique identifier (used for database naming)
   - **Subscriber URL**: Client's website URL
   - **Username**: Client's username for authentication
   - **Password**: Client's password
   - **Auth Token**: (Optional) Auto-generated if not provided

When you save, the system will:
- Create a subscriber record in the master database
- Create a new tenant database named `Tenant_{subscriberId}`
- Create a dedicated database user for the tenant
- Initialize the tenant database schema

### Creating Scheduled Tasks

1. Navigate to **Schedules** page
2. Click **Add Schedule**
3. Configure the task:
   - **Client**: Select the client for this task
   - **Task Name**: Descriptive name
   - **Description**: (Optional) Task details
   - **Task Type**: sync, backup, report, or custom
   - **Schedule**: Choose a preset or custom cron expression

### Cron Expression Format

```
* * * * *
│ │ │ │ │
│ │ │ │ └─ Day of week (0-7, Sunday = 0 or 7)
│ │ │ └─── Month (1-12)
│ │ └───── Day of month (1-31)
│ └─────── Hour (0-23)
└───────── Minute (0-59)
```

Examples:
- `0 * * * *` - Every hour at minute 0
- `0 9 * * 1-5` - Every weekday at 9 AM
- `*/15 * * * *` - Every 15 minutes
- `0 0 1 * *` - First day of every month at midnight

## API Endpoints

### Subscribers

- `GET /api/subscribers` - List all subscribers
- `POST /api/subscribers` - Create a new subscriber (with tenant database)
- `GET /api/subscribers/[id]` - Get subscriber details
- `PUT /api/subscribers/[id]` - Update subscriber
- `DELETE /api/subscribers/[id]` - Delete subscriber

### Schedules

- `GET /api/schedules` - List all scheduled tasks
- `GET /api/schedules?subscriberId=xxx` - List tasks for a specific subscriber
- `POST /api/schedules` - Create a new scheduled task
- `GET /api/schedules/[id]` - Get task details
- `PUT /api/schedules/[id]` - Update task
- `DELETE /api/schedules/[id]` - Delete task
- `GET /api/schedules/[id]/logs` - Get task execution logs

### Database

- `GET /api/init` - Check database status
- `POST /api/init` - Initialize master database

## Project Structure

```
Web/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── init/route.ts
│   │   │   ├── subscribers/
│   │   │   │   ├── route.ts
│   │   │   │   └── [id]/route.ts
│   │   │   └── schedules/
│   │   │       ├── route.ts
│   │   │       └── [id]/
│   │   │           ├── route.ts
│   │   │           └── logs/route.ts
│   │   ├── subscribers/page.tsx
│   │   ├── schedules/page.tsx
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── globals.css
│   ├── components/
│   │   ├── Navbar.tsx
│   │   ├── Modal.tsx
│   │   ├── SubscriberForm.tsx
│   │   ├── ScheduleForm.tsx
│   │   └── ConfirmDialog.tsx
│   ├── lib/
│   │   ├── db.ts
│   │   └── init-schema.ts
│   └── types/
│       └── index.ts
├── scripts/
│   └── init-database.ts
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── next.config.js
```

## Production Build

```bash
npm run build
npm run start
```

## Notes

- When deleting a subscriber, the tenant database is NOT automatically dropped to prevent accidental data loss. You can manually drop it if needed.
- Passwords are hashed using bcrypt before storage.
- Auth tokens are auto-generated using UUIDs if not provided.
- The application supports connection pooling for both master and tenant databases.
