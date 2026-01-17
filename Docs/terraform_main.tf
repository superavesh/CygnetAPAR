# Terraform Configuration for Data Processing Pipeline
# This is a comprehensive example - adjust based on your specific requirements

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Variables
variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "data-pipeline"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "rabbitmq_username" {
  description = "RabbitMQ username"
  type        = string
  sensitive   = true
}

variable "rabbitmq_password" {
  description = "RabbitMQ password"
  type        = string
  sensitive   = true
}

variable "db_username" {
  description = "PostgreSQL username"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}

variable "api_key" {
  description = "External API key"
  type        = string
  sensitive   = true
}

variable "api_base_url" {
  description = "External API base URL"
  type        = string
}

# Local variables
locals {
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Terraform"
  }
  name_prefix = "${var.project_name}-${var.environment}"
}

# VPC Configuration
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-igw"
  })
}

# Private Subnets for Lambda and RabbitMQ
resource "aws_subnet" "private_lambda" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private-lambda-${count.index + 1}"
    Tier = "Private"
  })
}

# Private Subnets for Data (PostgreSQL, EFS)
resource "aws_subnet" "private_data" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 3}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private-data-${count.index + 1}"
    Tier = "Private"
  })
}

# Public Subnets for NAT Gateways
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.${count.index + 10}.0/24"
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-${count.index + 1}"
    Tier = "Public"
  })
}

# Elastic IPs for NAT Gateways
resource "aws_eip" "nat" {
  count  = 2
  domain = "vpc"

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-nat-eip-${count.index + 1}"
  })
}

# NAT Gateways
resource "aws_nat_gateway" "main" {
  count         = 2
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-nat-${count.index + 1}"
  })

  depends_on = [aws_internet_gateway.main]
}

# Route Tables
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-public-rt"
  })
}

resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-private-rt-${count.index + 1}"
  })
}

# Route Table Associations
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private_lambda" {
  count          = 2
  subnet_id      = aws_subnet.private_lambda[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table_association" "private_data" {
  count          = 2
  subnet_id      = aws_subnet.private_data[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Data source for availability zones
data "aws_availability_zones" "available" {
  state = "available"
}

# Security Groups

# Lambda Security Group
resource "aws_security_group" "lambda" {
  name        = "${local.name_prefix}-lambda-sg"
  description = "Security group for Lambda functions"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-lambda-sg"
  })
}

# RabbitMQ Security Group
resource "aws_security_group" "rabbitmq" {
  name        = "${local.name_prefix}-rabbitmq-sg"
  description = "Security group for RabbitMQ"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "RabbitMQ from Lambda"
    from_port       = 5672
    to_port         = 5672
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  ingress {
    description = "RabbitMQ Management UI"
    from_port   = 15672
    to_port     = 15672
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"] # Restrict to VPC or specific IPs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-rabbitmq-sg"
  })
}

# EFS Security Group
resource "aws_security_group" "efs" {
  name        = "${local.name_prefix}-efs-sg"
  description = "Security group for EFS"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "NFS from Lambda"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-efs-sg"
  })
}

# PostgreSQL Security Group
resource "aws_security_group" "postgresql" {
  name        = "${local.name_prefix}-postgresql-sg"
  description = "Security group for PostgreSQL"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from Lambda"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-postgresql-sg"
  })
}

# EFS File System
resource "aws_efs_file_system" "main" {
  creation_token   = "${local.name_prefix}-efs"
  encrypted        = true
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-efs"
  })
}

# EFS Mount Targets
resource "aws_efs_mount_target" "main" {
  count           = 2
  file_system_id  = aws_efs_file_system.main.id
  subnet_id       = aws_subnet.private_data[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# EFS Access Point for Lambda
resource "aws_efs_access_point" "lambda" {
  file_system_id = aws_efs_file_system.main.id

  posix_user {
    gid = 1000
    uid = 1000
  }

  root_directory {
    path = "/lambda"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "755"
    }
  }

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-lambda-access-point"
  })
}

# RDS Subnet Group
resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = aws_subnet.private_data[*].id

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-db-subnet-group"
  })
}

# RDS PostgreSQL Instance
resource "aws_db_instance" "postgresql" {
  identifier     = "${local.name_prefix}-postgresql"
  engine         = "postgres"
  engine_version = "15.5"
  instance_class = "db.t3.medium"

  allocated_storage     = 100
  max_allocated_storage = 500
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "datawarehouse"
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.postgresql.id]

  multi_az               = var.environment == "prod" ? true : false
  backup_retention_period = 7
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"

  skip_final_snapshot       = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${local.name_prefix}-final-snapshot" : null

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-postgresql"
  })
}

# Amazon MQ (RabbitMQ)
resource "aws_mq_broker" "rabbitmq" {
  broker_name        = "${local.name_prefix}-rabbitmq"
  engine_type        = "RabbitMQ"
  engine_version     = "3.11.20"
  host_instance_type = "mq.t3.micro"
  deployment_mode    = var.environment == "prod" ? "CLUSTER_MULTI_AZ" : "SINGLE_INSTANCE"

  user {
    username = var.rabbitmq_username
    password = var.rabbitmq_password
  }

  subnet_ids         = var.environment == "prod" ? [aws_subnet.private_lambda[0].id, aws_subnet.private_lambda[1].id] : [aws_subnet.private_lambda[0].id]
  security_groups    = [aws_security_group.rabbitmq.id]
  publicly_accessible = false

  logs {
    general = true
  }

  tags = local.common_tags
}

# IAM Role for Lambda Functions
resource "aws_iam_role" "lambda_role" {
  name = "${local.name_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

# IAM Policy for Lambda
resource "aws_iam_role_policy" "lambda_policy" {
  name = "${local.name_prefix}-lambda-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:AssignPrivateIpAddresses",
          "ec2:UnassignPrivateIpAddresses"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "elasticfilesystem:ClientMount",
          "elasticfilesystem:ClientWrite",
          "elasticfilesystem:ClientRead"
        ]
        Resource = aws_efs_file_system.main.arn
      },
      {
        Effect = "Allow"
        Action = [
          "mq:DescribeBroker"
        ]
        Resource = aws_mq_broker.rabbitmq.arn
      }
    ]
  })
}

# Lambda Layer for Dependencies
resource "aws_lambda_layer_version" "dependencies" {
  filename            = "lambda-layer.zip" # You need to create this
  layer_name          = "${local.name_prefix}-dependencies"
  compatible_runtimes = ["python3.11"]

  lifecycle {
    ignore_changes = [filename]
  }
}

# API Caller Lambda Function
resource "aws_lambda_function" "api_caller" {
  filename         = "api_caller_lambda.zip" # You need to create this
  function_name    = "${local.name_prefix}-api-caller"
  role            = aws_iam_role.lambda_role.arn
  handler         = "api_caller_lambda.lambda_handler"
  runtime         = "python3.11"
  timeout         = 900
  memory_size     = 1024

  layers = [aws_lambda_layer_version.dependencies.arn]

  vpc_config {
    subnet_ids         = aws_subnet.private_lambda[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  file_system_config {
    arn              = aws_efs_access_point.lambda.arn
    local_mount_path = "/mnt/efs"
  }

  environment {
    variables = {
      RABBITMQ_HOST            = split(":", split("//", aws_mq_broker.rabbitmq.instances[0].endpoints[0])[1])[0]
      RABBITMQ_PORT            = "5672"
      RABBITMQ_USERNAME        = var.rabbitmq_username
      RABBITMQ_PASSWORD        = var.rabbitmq_password
      API_REQUEST_QUEUE        = "api_requests_queue"
      FILE_PROCESSING_QUEUE    = "file_processing_queue"
      EFS_MOUNT_PATH           = "/mnt/efs/data"
      API_BASE_URL             = var.api_base_url
      API_KEY                  = var.api_key
    }
  }

  tags = local.common_tags

  depends_on = [
    aws_efs_mount_target.main
  ]
}

# CSV Processor Lambda Function
resource "aws_lambda_function" "csv_processor" {
  filename         = "csv_processor_lambda.zip" # You need to create this
  function_name    = "${local.name_prefix}-csv-processor"
  role            = aws_iam_role.lambda_role.arn
  handler         = "csv_processor_lambda.lambda_handler"
  runtime         = "python3.11"
  timeout         = 900
  memory_size     = 2048
  reserved_concurrent_executions = 10

  layers = [aws_lambda_layer_version.dependencies.arn]

  vpc_config {
    subnet_ids         = aws_subnet.private_lambda[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  file_system_config {
    arn              = aws_efs_access_point.lambda.arn
    local_mount_path = "/mnt/efs"
  }

  environment {
    variables = {
      RABBITMQ_HOST         = split(":", split("//", aws_mq_broker.rabbitmq.instances[0].endpoints[0])[1])[0]
      RABBITMQ_PORT         = "5672"
      RABBITMQ_USERNAME     = var.rabbitmq_username
      RABBITMQ_PASSWORD     = var.rabbitmq_password
      FILE_PROCESSING_QUEUE = "file_processing_queue"
      EFS_MOUNT_PATH        = "/mnt/efs/data"
      DB_HOST               = aws_db_instance.postgresql.address
      DB_PORT               = "5432"
      DB_NAME               = aws_db_instance.postgresql.db_name
      DB_USERNAME           = var.db_username
      DB_PASSWORD           = var.db_password
      BATCH_INSERT_SIZE     = "1000"
    }
  }

  tags = local.common_tags

  depends_on = [
    aws_efs_mount_target.main,
    aws_db_instance.postgresql
  ]
}

# Job Scheduler Lambda Function
resource "aws_lambda_function" "job_scheduler" {
  filename      = "job_scheduler_lambda.zip" # You need to create this
  function_name = "${local.name_prefix}-job-scheduler"
  role         = aws_iam_role.lambda_role.arn
  handler      = "job_scheduler_lambda.lambda_handler"
  runtime      = "python3.11"
  timeout      = 300
  memory_size  = 512

  layers = [aws_lambda_layer_version.dependencies.arn]

  vpc_config {
    subnet_ids         = aws_subnet.private_lambda[*].id
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      RABBITMQ_HOST      = split(":", split("//", aws_mq_broker.rabbitmq.instances[0].endpoints[0])[1])[0]
      RABBITMQ_PORT      = "5672"
      RABBITMQ_USERNAME  = var.rabbitmq_username
      RABBITMQ_PASSWORD  = var.rabbitmq_password
      API_REQUEST_QUEUE  = "api_requests_queue"
      DB_HOST            = aws_db_instance.postgresql.address
      DB_PORT            = "5432"
      DB_NAME            = aws_db_instance.postgresql.db_name
      DB_USERNAME        = var.db_username
      DB_PASSWORD        = var.db_password
    }
  }

  tags = local.common_tags
}

# EventBridge Rule for Job Scheduler (daily at 2 AM)
resource "aws_cloudwatch_event_rule" "scheduler" {
  name                = "${local.name_prefix}-daily-schedule"
  description         = "Trigger job scheduler daily"
  schedule_expression = "cron(0 2 * * ? *)"

  tags = local.common_tags
}

resource "aws_cloudwatch_event_target" "scheduler" {
  rule      = aws_cloudwatch_event_rule.scheduler.name
  target_id = "JobSchedulerLambda"
  arn       = aws_lambda_function.job_scheduler.arn
}

resource "aws_lambda_permission" "allow_eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.job_scheduler.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scheduler.arn
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "api_caller" {
  name              = "/aws/lambda/${aws_lambda_function.api_caller.function_name}"
  retention_in_days = 14

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "csv_processor" {
  name              = "/aws/lambda/${aws_lambda_function.csv_processor.function_name}"
  retention_in_days = 14

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "job_scheduler" {
  name              = "/aws/lambda/${aws_lambda_function.job_scheduler.function_name}"
  retention_in_days = 14

  tags = local.common_tags
}

# Outputs
output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "efs_id" {
  description = "EFS File System ID"
  value       = aws_efs_file_system.main.id
}

output "rds_endpoint" {
  description = "RDS endpoint"
  value       = aws_db_instance.postgresql.endpoint
  sensitive   = true
}

output "rabbitmq_endpoint" {
  description = "RabbitMQ endpoint"
  value       = aws_mq_broker.rabbitmq.instances[0].endpoints[0]
  sensitive   = true
}

output "rabbitmq_console_url" {
  description = "RabbitMQ management console URL"
  value       = aws_mq_broker.rabbitmq.instances[0].console_url
}

output "lambda_api_caller_arn" {
  description = "API Caller Lambda ARN"
  value       = aws_lambda_function.api_caller.arn
}

output "lambda_csv_processor_arn" {
  description = "CSV Processor Lambda ARN"
  value       = aws_lambda_function.csv_processor.arn
}

output "lambda_job_scheduler_arn" {
  description = "Job Scheduler Lambda ARN"
  value       = aws_lambda_function.job_scheduler.arn
}
