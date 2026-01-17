# Deployment Guide - Data Processing Pipeline

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Terraform** >= 1.0 installed
3. **AWS CLI** configured with credentials
4. **Python 3.11** for local testing
5. **Docker** (optional, for building Lambda layers)

## Step-by-Step Deployment

### Step 1: Prepare Configuration

Create a `terraform.tfvars` file with your specific values:

```hcl
aws_region = "us-east-1"
project_name = "data-pipeline"
environment = "dev"

# RabbitMQ credentials
rabbitmq_username = "admin"
rabbitmq_password = "YourSecurePassword123!"

# PostgreSQL credentials
db_username = "dbadmin"
db_password = "YourSecureDBPassword123!"

# API credentials
api_base_url = "https://your-api.example.com"
api_key = "your-api-key-here"
```

**Security Note**: Never commit `terraform.tfvars` to version control!

### Step 2: Build Lambda Deployment Packages

#### Option A: Using pip and zip

```bash
# Create directory structure
mkdir -p lambda_packages/api_caller
mkdir -p lambda_packages/csv_processor
mkdir -p lambda_packages/job_scheduler
mkdir -p lambda_layer/python

# Install dependencies for Lambda layer
pip install -r requirements.txt -t lambda_layer/python/

# Create Lambda layer zip
cd lambda_layer
zip -r ../lambda-layer.zip python/
cd ..

# Package Lambda functions
cd lambda_packages/api_caller
cp ../../api_caller_lambda.py .
zip -r ../../api_caller_lambda.zip api_caller_lambda.py
cd ../..

cd lambda_packages/csv_processor
cp ../../csv_processor_lambda.py .
zip -r ../../csv_processor_lambda.zip csv_processor_lambda.py
cd ../..

cd lambda_packages/job_scheduler
cp ../../job_scheduler_lambda.py .
zip -r ../../job_scheduler_lambda.zip job_scheduler_lambda.py
cd ../..
```

#### Option B: Using Docker for consistent builds

```bash
# Build Lambda layer
docker run --rm -v "$PWD":/var/task \
  public.ecr.aws/lambda/python:3.11 \
  pip install -r requirements.txt -t python/

zip -r lambda-layer.zip python/
rm -rf python/

# Package Lambda functions
for func in api_caller csv_processor job_scheduler; do
  cp ${func}_lambda.py deployment/
  cd deployment
  zip ${func}_lambda.zip ${func}_lambda.py
  mv ${func}_lambda.zip ../
  cd ..
done
```

### Step 3: Initialize Terraform

```bash
terraform init
```

Expected output:
```
Initializing the backend...
Initializing provider plugins...
Terraform has been successfully initialized!
```

### Step 4: Plan Infrastructure

```bash
terraform plan -out=tfplan
```

Review the plan carefully. You should see resources being created for:
- VPC, subnets, NAT gateways
- Security groups
- EFS file system
- RDS PostgreSQL
- Amazon MQ (RabbitMQ)
- Lambda functions
- CloudWatch resources

### Step 5: Apply Infrastructure

```bash
terraform apply tfplan
```

This will take approximately 15-20 minutes. The RDS and Amazon MQ resources take the longest.

### Step 6: Initialize Database Schema

After deployment completes, get the RDS endpoint:

```bash
terraform output rds_endpoint
```

Connect to PostgreSQL and run the schema:

```bash
# Using psql
psql -h your-rds-endpoint -U dbadmin -d datawarehouse -f database_schema.sql

# Or using DBeaver, pgAdmin, etc.
```

### Step 7: Configure RabbitMQ Queues

Get the RabbitMQ console URL:

```bash
terraform output rabbitmq_console_url
```

1. Open the URL in your browser
2. Login with credentials from `terraform.tfvars`
3. Verify queues are created (Lambda will auto-create them):
   - `api_requests_queue`
   - `file_processing_queue`

Configure Dead Letter Queues:

```bash
# These commands can be run via RabbitMQ management API or UI
# api_requests_queue DLQ
rabbitmqadmin declare queue name=api_requests_dlq durable=true

# file_processing_queue DLQ
rabbitmqadmin declare queue name=file_processing_dlq durable=true

# Create dead letter exchanges
rabbitmqadmin declare exchange name=api_requests_dlx type=direct durable=true
rabbitmqadmin declare exchange name=file_processing_dlx type=direct durable=true

# Bind queues
rabbitmqadmin declare binding source=api_requests_dlx destination=api_requests_dlq
rabbitmqadmin declare binding source=file_processing_dlx destination=file_processing_dlq
```

### Step 8: Configure Lambda Event Source Mappings

Lambda needs to be connected to RabbitMQ queues:

```bash
# Get Lambda function ARNs
API_CALLER_ARN=$(terraform output -raw lambda_api_caller_arn)
CSV_PROCESSOR_ARN=$(terraform output -raw lambda_csv_processor_arn)
RABBITMQ_ARN=$(aws mq list-brokers --query 'BrokerSummaries[0].BrokerArn' --output text)

# Create event source mapping for API Caller
aws lambda create-event-source-mapping \
  --function-name $API_CALLER_ARN \
  --batch-size 1 \
  --source-access-configuration Type=BASIC_AUTH,URI=arn:aws:secretsmanager:region:account:secret:rabbitmq-credentials \
  --queues api_requests_queue \
  --event-source-arn $RABBITMQ_ARN

# Create event source mapping for CSV Processor
aws lambda create-event-source-mapping \
  --function-name $CSV_PROCESSOR_ARN \
  --batch-size 1 \
  --source-access-configuration Type=BASIC_AUTH,URI=arn:aws:secretsmanager:region:account:secret:rabbitmq-credentials \
  --queues file_processing_queue \
  --event-source-arn $RABBITMQ_ARN
```

**Note**: You may need to store RabbitMQ credentials in AWS Secrets Manager first.

### Step 9: Create EFS Directory Structure

Since Lambda has limited write permissions on first run, create directories:

```bash
# Connect to a bastion host or use AWS Systems Manager Session Manager
# Mount EFS and create directories

sudo mkdir -p /mnt/efs/lambda/data/{pending,completed,failed,archive}
sudo chown -R 1000:1000 /mnt/efs/lambda
sudo chmod -R 755 /mnt/efs/lambda
```

Alternatively, run the Job Scheduler Lambda once to auto-create directories.

### Step 10: Test the Pipeline

#### Manual Test - Trigger Job Scheduler

```bash
# Invoke Job Scheduler Lambda
aws lambda invoke \
  --function-name data-pipeline-dev-job-scheduler \
  --payload '{"locations":["LOC001"],"subscribers":["SUB001"]}' \
  response.json

cat response.json
```

#### Monitor Execution

```bash
# Check CloudWatch Logs
aws logs tail /aws/lambda/data-pipeline-dev-api-caller --follow
aws logs tail /aws/lambda/data-pipeline-dev-csv-processor --follow

# Check RabbitMQ queue depth
# Via RabbitMQ Management Console

# Check PostgreSQL for data
psql -h your-rds-endpoint -U dbadmin -d datawarehouse
SELECT COUNT(*) FROM subscriber_location_data;
SELECT * FROM file_processing_metadata ORDER BY created_at DESC LIMIT 5;
```

### Step 11: Configure Monitoring and Alarms

Create CloudWatch alarms:

```bash
# High error rate alarm
aws cloudwatch put-metric-alarm \
  --alarm-name data-pipeline-high-error-rate \
  --alarm-description "Alert when Lambda error rate exceeds 5%" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5.0 \
  --comparison-operator GreaterThanThreshold

# Add more alarms as needed...
```

## Validation Checklist

- [ ] VPC and networking created successfully
- [ ] EFS mounted and accessible
- [ ] RDS PostgreSQL running and schema applied
- [ ] RabbitMQ broker running and accessible
- [ ] Lambda functions deployed with correct environment variables
- [ ] Event source mappings created and enabled
- [ ] CloudWatch log groups created
- [ ] Test job scheduler executed successfully
- [ ] Test message processed through entire pipeline
- [ ] Data inserted into PostgreSQL correctly
- [ ] Monitoring and alarms configured

## Common Issues and Solutions

### Issue 1: Lambda Cannot Connect to RabbitMQ

**Solution**: 
- Verify Lambda is in the correct VPC subnets
- Check security group allows port 5672
- Verify NAT gateway for outbound connectivity

### Issue 2: Lambda Timeout Errors

**Solution**:
- Increase Lambda timeout (max 900 seconds)
- Increase Lambda memory (more memory = more CPU)
- Optimize API calls or batch size

### Issue 3: EFS Mount Failures

**Solution**:
- Verify EFS mount targets in correct subnets
- Check security group allows NFS (port 2049)
- Ensure Lambda has elasticfilesystem:ClientMount permission

### Issue 4: Database Connection Pool Exhausted

**Solution**:
- Reduce Lambda concurrent executions for CSV Processor
- Use RDS Proxy for connection pooling
- Increase max_connections in PostgreSQL

### Issue 5: RabbitMQ Queue Buildup

**Solution**:
- Increase Lambda concurrent executions
- Check for Lambda errors preventing message acknowledgment
- Verify API rate limits not causing slowdowns

## Cleanup

To destroy all resources:

```bash
# This will delete EVERYTHING including data!
terraform destroy
```

**Warning**: This action is irreversible. Back up your data first!

## Next Steps

1. **Production Hardening**:
   - Enable Multi-AZ for RDS and RabbitMQ
   - Set up automated backups
   - Configure CloudWatch alarms
   - Implement AWS WAF for API Gateway (if added)

2. **Cost Optimization**:
   - Use Reserved Instances for RDS
   - Enable EFS lifecycle policies
   - Review Lambda memory settings
   - Set up AWS Budgets

3. **Security Enhancements**:
   - Rotate credentials regularly
   - Enable AWS CloudTrail
   - Set up VPC Flow Logs
   - Implement least privilege IAM policies

4. **Performance Tuning**:
   - Profile Lambda execution times
   - Optimize database queries
   - Adjust batch sizes
   - Tune PostgreSQL parameters

## Support and Troubleshooting

For issues, check:
1. CloudWatch Logs for Lambda functions
2. RabbitMQ Management Console for queue metrics
3. RDS Performance Insights for database performance
4. VPC Flow Logs for network issues

## Architecture Diagram

```
┌─────────────────┐
│  EventBridge    │
│   Schedule      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Job Scheduler   │
│    Lambda       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   RabbitMQ      │
│ api_requests_q  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌─────────────┐
│  API Caller     │─────▶│   AWS EFS   │
│    Lambda       │      │  CSV Files  │
└────────┬────────┘      └─────────────┘
         │
         ▼
┌─────────────────┐
│   RabbitMQ      │
│file_processing_q│
└────────┬────────┘
         │
         ▼
┌─────────────────┐      ┌─────────────┐
│ CSV Processor   │─────▶│ PostgreSQL  │
│    Lambda       │      │     RDS     │
└─────────────────┘      └─────────────┘
```
