# Data Processing Pipeline Architecture

## Overview
This architecture processes large CSV files through a distributed system using RabbitMQ for queuing, AWS Lambda for processing, EFS for storage, and PostgreSQL for data persistence.

## Architecture Components

### 1. Message Queue Layer (RabbitMQ)

#### Queue 1: API Request Queue (`api_requests_queue`)
**Purpose**: Queue API call parameters for each location and subscriber combination

**Message Structure**:
```json
{
  "request_id": "uuid",
  "location_id": "LOC001",
  "subscriber_id": "SUB001",
  "api_call_sequence": 1,
  "timestamp": "2026-01-14T10:30:00Z",
  "retry_count": 0
}
```

**Configuration**:
- Durable: Yes
- Auto-delete: No
- Prefetch count: 1-5 (per Lambda worker)
- Message TTL: 1 hour
- Dead Letter Exchange: `api_requests_dlx`

#### Queue 2: File Processing Queue (`file_processing_queue`)
**Purpose**: Queue CSV file metadata for database insertion

**Message Structure**:
```json
{
  "file_id": "uuid",
  "location_id": "LOC001",
  "subscriber_id": "SUB001",
  "efs_path": "/mnt/efs/data/LOC001_SUB001_20260114.csv",
  "file_size": 1048576,
  "row_count": 10000,
  "created_at": "2026-01-14T10:35:00Z",
  "checksum": "sha256_hash"
}
```

**Configuration**:
- Durable: Yes
- Auto-delete: No
- Prefetch count: 1
- Message TTL: 2 hours
- Dead Letter Exchange: `file_processing_dlx`

#### Dead Letter Queues
- `api_requests_dlq`: Failed API requests
- `file_processing_dlq`: Failed file processing tasks

---

## 2. Lambda Functions

### Lambda 1: API Caller (`api-caller-lambda`)

**Purpose**: Consume messages from API request queue, make API calls, store CSV files

**Configuration**:
```yaml
Runtime: Python 3.11 / Node.js 18.x
Memory: 1024 MB - 3008 MB
Timeout: 900 seconds (15 minutes)
Concurrency: 10-50 (based on API rate limits)
VPC: Yes (to access RabbitMQ and EFS)
```

**Environment Variables**:
```
RABBITMQ_HOST=your-rabbitmq-host
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=api_caller
RABBITMQ_PASSWORD=secure_password
API_REQUEST_QUEUE=api_requests_queue
FILE_PROCESSING_QUEUE=file_processing_queue
EFS_MOUNT_PATH=/mnt/efs/data
API_BASE_URL=https://api.example.com
API_KEY=your_api_key
MAX_RETRIES=3
```

**Trigger**:
- Event Source: RabbitMQ (via Lambda event source mapping)
- Batch size: 1
- Batch window: 0 seconds

**Workflow**:
1. Receive message from `api_requests_queue`
2. Extract location_id and subscriber_id
3. Make 3 sequential API calls for the subscriber-location combination
4. Combine results into a single CSV file
5. Store CSV file in EFS with naming convention: `{location_id}_{subscriber_id}_{timestamp}.csv`
6. Calculate file metadata (size, row count, checksum)
7. Publish message to `file_processing_queue` with file details
8. Acknowledge message from `api_requests_queue`
9. Handle errors and retry logic

**IAM Permissions**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite"
      ],
      "Resource": "arn:aws:elasticfilesystem:region:account:file-system/fs-xxxxx"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "mq:DescribeBroker"
      ],
      "Resource": "*"
    }
  ]
}
```

---

### Lambda 2: CSV Processor (`csv-processor-lambda`)

**Purpose**: Consume messages from file processing queue, read CSV from EFS, insert into PostgreSQL

**Configuration**:
```yaml
Runtime: Python 3.11
Memory: 2048 MB - 10240 MB
Timeout: 900 seconds (15 minutes)
Concurrency: 5-10
VPC: Yes (to access RabbitMQ, EFS, and PostgreSQL)
Reserved Concurrency: 10 (to avoid database overload)
```

**Environment Variables**:
```
RABBITMQ_HOST=your-rabbitmq-host
RABBITMQ_PORT=5672
RABBITMQ_USERNAME=csv_processor
RABBITMQ_PASSWORD=secure_password
FILE_PROCESSING_QUEUE=file_processing_queue
EFS_MOUNT_PATH=/mnt/efs/data
DB_HOST=your-postgres-host
DB_PORT=5432
DB_NAME=data_warehouse
DB_USERNAME=csv_processor
DB_PASSWORD=secure_password
BATCH_INSERT_SIZE=1000
```

**Trigger**:
- Event Source: RabbitMQ (via Lambda event source mapping)
- Batch size: 1
- Batch window: 0 seconds

**Workflow**:
1. Receive message from `file_processing_queue`
2. Read CSV file from EFS using provided path
3. Validate CSV structure and data quality
4. Connect to PostgreSQL database
5. Begin database transaction
6. Insert data in batches (1000-5000 rows per batch)
7. Update metadata table with file processing status
8. Commit transaction
9. Acknowledge message from `file_processing_queue`
10. Archive or delete CSV file from EFS (optional)
11. Handle errors and implement retry logic

**IAM Permissions**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientRead",
        "elasticfilesystem:ClientWrite"
      ],
      "Resource": "arn:aws:elasticfilesystem:region:account:file-system/fs-xxxxx"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ],
      "Resource": "*"
    }
  ]
}
```

---

## 3. Storage Layer

### AWS EFS (Elastic File System)

**Purpose**: Shared file storage accessible by multiple Lambda functions

**Configuration**:
```yaml
Performance Mode: General Purpose / Max I/O
Throughput Mode: Bursting / Provisioned
Lifecycle Policy: Transition to IA after 30 days
Backup: AWS Backup daily
Encryption: At rest (KMS) and in transit (TLS)
```

**Directory Structure**:
```
/mnt/efs/
├── data/
│   ├── pending/          # Files being written
│   ├── completed/        # Successfully processed files
│   ├── failed/           # Failed processing files
│   └── archive/          # Old files (if retention needed)
└── logs/
    └── processing/       # Processing logs (optional)
```

**Mount Targets**:
- Create mount targets in each AZ where Lambda functions run
- Ensure mount targets are in the same VPC as Lambda functions

---

### PostgreSQL Database

**Purpose**: Store processed CSV data

**Recommended Setup**: Amazon RDS PostgreSQL or Aurora PostgreSQL

**Configuration**:
```yaml
Engine: PostgreSQL 15.x / Aurora PostgreSQL
Instance Class: db.r6g.xlarge (or appropriate size)
Storage: GP3 SSD (with autoscaling)
Multi-AZ: Yes (for production)
Backup: Automated daily backups
Connection Pooling: Yes (using RDS Proxy)
```

**Database Schema Example**:
```sql
-- Main data table
CREATE TABLE subscriber_location_data (
    id BIGSERIAL PRIMARY KEY,
    location_id VARCHAR(50) NOT NULL,
    subscriber_id VARCHAR(50) NOT NULL,
    data_column_1 VARCHAR(255),
    data_column_2 NUMERIC,
    data_column_3 TIMESTAMP,
    -- Add your specific columns here
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    file_id UUID NOT NULL,
    CONSTRAINT unique_subscriber_location_record UNIQUE (location_id, subscriber_id, data_column_1)
);

-- File processing metadata table
CREATE TABLE file_processing_metadata (
    file_id UUID PRIMARY KEY,
    location_id VARCHAR(50) NOT NULL,
    subscriber_id VARCHAR(50) NOT NULL,
    efs_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    row_count INTEGER,
    status VARCHAR(20) DEFAULT 'pending',
    processing_started_at TIMESTAMP,
    processing_completed_at TIMESTAMP,
    error_message TEXT,
    checksum VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_location_subscriber ON subscriber_location_data(location_id, subscriber_id);
CREATE INDEX idx_created_at ON subscriber_location_data(created_at);
CREATE INDEX idx_file_id ON subscriber_location_data(file_id);
CREATE INDEX idx_processing_status ON file_processing_metadata(status);
CREATE INDEX idx_location_subscriber_meta ON file_processing_metadata(location_id, subscriber_id);
```

---

## 4. Network Architecture

### VPC Configuration

**Components**:
```
VPC: 10.0.0.0/16
├── Private Subnets (2+ AZs)
│   ├── 10.0.1.0/24 (Lambda, RabbitMQ)
│   └── 10.0.2.0/24 (Lambda, RabbitMQ)
├── Private Subnets - Data (2+ AZs)
│   ├── 10.0.3.0/24 (PostgreSQL, EFS)
│   └── 10.0.4.0/24 (PostgreSQL, EFS)
└── NAT Gateways (for outbound API calls)
    ├── NAT Gateway in AZ-1
    └── NAT Gateway in AZ-2
```

**Security Groups**:

**Lambda Security Group**:
- Outbound: Port 5672 (RabbitMQ), Port 5432 (PostgreSQL), Port 2049 (EFS), Port 443 (external APIs)

**RabbitMQ Security Group**:
- Inbound: Port 5672 from Lambda SG
- Inbound: Port 15672 (Management UI) from bastion/admin

**EFS Security Group**:
- Inbound: Port 2049 from Lambda SG

**PostgreSQL Security Group**:
- Inbound: Port 5432 from Lambda SG

---

## 5. Message Producer (Initial Setup)

### Lambda 3: Job Scheduler (`job-scheduler-lambda`)

**Purpose**: Generate and publish messages to API request queue

**Trigger Options**:
- EventBridge Schedule (cron-based)
- S3 event (configuration file upload)
- API Gateway (manual trigger)
- Step Functions (orchestration)

**Workflow**:
```python
def generate_messages():
    locations = get_locations()  # From database or config
    subscribers = get_subscribers()  # From database or config
    
    messages = []
    for location in locations:
        for subscriber in subscribers:
            for api_call in range(1, 4):  # 3 API calls per combination
                message = {
                    "request_id": str(uuid.uuid4()),
                    "location_id": location,
                    "subscriber_id": subscriber,
                    "api_call_sequence": api_call,
                    "timestamp": datetime.utcnow().isoformat(),
                    "retry_count": 0
                }
                publish_to_rabbitmq(message, 'api_requests_queue')
```

---

## 6. Monitoring and Observability

### CloudWatch Metrics

**Lambda Metrics**:
- Invocations
- Duration
- Errors
- Throttles
- Concurrent Executions
- Iterator Age (for RabbitMQ event source)

**Custom Metrics**:
- API call success/failure rate
- CSV file processing time
- Database insertion rate
- Queue depth
- Message processing latency

### CloudWatch Alarms

```
1. High error rate in API caller (> 5%)
2. High error rate in CSV processor (> 5%)
3. Lambda throttling detected
4. RabbitMQ queue depth > 10000 messages
5. EFS storage utilization > 80%
6. PostgreSQL connection count > 80%
7. Lambda timeout rate > 2%
```

### CloudWatch Logs

**Log Groups**:
- `/aws/lambda/api-caller-lambda`
- `/aws/lambda/csv-processor-lambda`
- `/aws/lambda/job-scheduler-lambda`

**Structured Logging**:
```json
{
  "timestamp": "2026-01-14T10:30:00Z",
  "level": "INFO",
  "function": "api-caller",
  "request_id": "uuid",
  "location_id": "LOC001",
  "subscriber_id": "SUB001",
  "action": "api_call_completed",
  "duration_ms": 1500,
  "status": "success"
}
```

---

## 7. Error Handling and Retry Strategy

### API Caller Lambda

**Error Scenarios**:
1. **API Rate Limit**: Exponential backoff, requeue with delay
2. **API Timeout**: Retry up to 3 times
3. **API 5xx Errors**: Retry with exponential backoff
4. **EFS Write Error**: Alert and move to DLQ
5. **RabbitMQ Publish Error**: Alert and retry

**Retry Configuration**:
```python
MAX_RETRIES = 3
BACKOFF_MULTIPLIER = 2  # seconds
BACKOFF_BASE = 5  # seconds

retry_delay = BACKOFF_BASE * (BACKOFF_MULTIPLIER ** retry_count)
```

### CSV Processor Lambda

**Error Scenarios**:
1. **File Not Found**: Alert and move to DLQ
2. **Corrupt CSV**: Log error, move file to failed directory
3. **Database Connection Error**: Retry with exponential backoff
4. **Constraint Violation**: Log, skip row, continue processing
5. **Transaction Timeout**: Reduce batch size, retry

**Transaction Management**:
```python
try:
    conn.begin()
    for batch in read_csv_in_batches(file_path, batch_size=1000):
        insert_batch(batch)
    conn.commit()
except Exception as e:
    conn.rollback()
    raise
```

---

## 8. Scalability Considerations

### Horizontal Scaling

**Lambda Concurrency**:
- API Caller: Scale based on API rate limits (10-50 concurrent)
- CSV Processor: Limited by database connections (5-10 concurrent)

**RabbitMQ**:
- Use clustered RabbitMQ for high availability
- Configure queue mirroring across nodes
- Monitor queue depth and adjust Lambda concurrency

**Database**:
- Use connection pooling (RDS Proxy)
- Read replicas for reporting queries
- Partition tables by date if data volume is very high
- Consider Aurora Serverless for variable workloads

### Vertical Scaling

**Lambda Memory**:
- Start with 1024 MB, increase based on profiling
- More memory = more CPU = faster processing

**RDS Instance**:
- Monitor CPU, memory, and IOPS
- Scale instance class as needed
- Enable autoscaling for storage

---

## 9. Cost Optimization

### Lambda
- Use ARM (Graviton2) architecture for 20% cost savings
- Right-size memory allocation
- Use reserved concurrency only where needed

### EFS
- Use lifecycle policies to move old files to Infrequent Access
- Delete processed files after retention period
- Use EFS Intelligent-Tiering

### RDS
- Use Reserved Instances for predictable workloads
- Enable autoscaling for storage
- Use Aurora Serverless v2 for variable workloads

### RabbitMQ
- Use Amazon MQ (managed RabbitMQ) for easier management
- Or self-manage on EC2 with autoscaling

---

## 10. Deployment and Infrastructure as Code

### Terraform/CloudFormation Structure

```
infrastructure/
├── vpc.tf                    # VPC, subnets, NAT gateways
├── security-groups.tf        # All security groups
├── efs.tf                    # EFS file system
├── rds.tf                    # PostgreSQL database
├── rabbitmq.tf              # Amazon MQ or EC2-based RabbitMQ
├── lambda-api-caller.tf     # API caller Lambda
├── lambda-csv-processor.tf  # CSV processor Lambda
├── lambda-scheduler.tf      # Job scheduler Lambda
├── iam.tf                   # IAM roles and policies
├── cloudwatch.tf            # Alarms and dashboards
└── variables.tf             # Configuration variables
```

---

## 11. Data Flow Diagram

```
┌─────────────────┐
│  Job Scheduler  │
│     Lambda      │
└────────┬────────┘
         │ Publishes messages
         ▼
┌─────────────────────────────┐
│       RabbitMQ              │
│  ┌───────────────────────┐  │
│  │ api_requests_queue    │  │
│  └───────────┬───────────┘  │
└──────────────┼──────────────┘
               │ Consumes
               ▼
┌─────────────────────────────┐
│   API Caller Lambda         │
│  (Concurrent Instances)     │
└────────┬────────────────────┘
         │ 1. Makes 3 API calls
         │ 2. Stores CSV to EFS
         │ 3. Publishes file metadata
         ▼
┌─────────────────────────────┐
│         AWS EFS             │
│  /mnt/efs/data/             │
│    ├── pending/             │
│    └── completed/           │
└─────────────────────────────┘
         │
         │ File metadata published
         ▼
┌─────────────────────────────┐
│       RabbitMQ              │
│  ┌───────────────────────┐  │
│  │ file_processing_queue │  │
│  └───────────┬───────────┘  │
└──────────────┼──────────────┘
               │ Consumes
               ▼
┌─────────────────────────────┐
│  CSV Processor Lambda       │
│  (Controlled Concurrency)   │
└────────┬────────────────────┘
         │ 1. Reads CSV from EFS
         │ 2. Inserts into PostgreSQL
         ▼
┌─────────────────────────────┐
│    PostgreSQL Database      │
│  ┌───────────────────────┐  │
│  │ subscriber_location_  │  │
│  │       data            │  │
│  ├───────────────────────┤  │
│  │ file_processing_      │  │
│  │     metadata          │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

---

## 12. Best Practices Summary

1. **Message Idempotency**: Include unique request_id in messages to handle duplicates
2. **Graceful Degradation**: Use DLQs and retry strategies
3. **Monitoring**: Set up comprehensive CloudWatch alarms
4. **Security**: Use VPC, security groups, and encrypted storage
5. **Cost Efficiency**: Right-size resources and use lifecycle policies
6. **Data Integrity**: Use database transactions and checksums
7. **Performance**: Batch database inserts and use connection pooling
8. **High Availability**: Deploy across multiple AZs
9. **Testing**: Test with realistic data volumes before production
10. **Documentation**: Maintain runbooks for common issues

---

## 13. Alternative Considerations

### SQS Instead of RabbitMQ
If you prefer a fully managed AWS service:
- Use Amazon SQS standard queues
- Benefits: Fully managed, unlimited scalability, native Lambda integration
- Trade-offs: No complex routing, no priority queues

### Step Functions for Orchestration
For complex workflows:
- Use Step Functions to orchestrate Lambda functions
- Benefits: Visual workflow, built-in error handling, state management
- Use case: When you need complex coordination between steps

### S3 Instead of EFS
For large-scale file storage:
- Store CSV files in S3 instead of EFS
- Benefits: Lower cost, unlimited storage, better for archival
- Trade-offs: Slightly higher latency for small files

### Batch Processing
For non-real-time processing:
- Use AWS Batch for long-running CSV processing
- Benefits: Better for CPU-intensive operations
- Use case: When processing takes > 15 minutes per file
