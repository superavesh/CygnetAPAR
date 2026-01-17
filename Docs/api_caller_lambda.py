"""
API Caller Lambda Function
Consumes messages from RabbitMQ, makes API calls, stores CSV in EFS, publishes to next queue
"""

import json
import os
import csv
import uuid
import hashlib
from datetime import datetime
from typing import Dict, List, Any
import pika
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Environment variables
RABBITMQ_HOST = os.environ['RABBITMQ_HOST']
RABBITMQ_PORT = int(os.environ.get('RABBITMQ_PORT', 5672))
RABBITMQ_USERNAME = os.environ['RABBITMQ_USERNAME']
RABBITMQ_PASSWORD = os.environ['RABBITMQ_PASSWORD']
API_REQUEST_QUEUE = os.environ.get('API_REQUEST_QUEUE', 'api_requests_queue')
FILE_PROCESSING_QUEUE = os.environ.get('FILE_PROCESSING_QUEUE', 'file_processing_queue')
EFS_MOUNT_PATH = os.environ.get('EFS_MOUNT_PATH', '/mnt/efs/data')
API_BASE_URL = os.environ['API_BASE_URL']
API_KEY = os.environ['API_KEY']
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', 3))


class RabbitMQConnection:
    """Manages RabbitMQ connection and operations"""
    
    def __init__(self):
        credentials = pika.PlainCredentials(RABBITMQ_USERNAME, RABBITMQ_PASSWORD)
        parameters = pika.ConnectionParameters(
            host=RABBITMQ_HOST,
            port=RABBITMQ_PORT,
            credentials=credentials,
            heartbeat=600,
            blocked_connection_timeout=300
        )
        self.connection = pika.BlockingConnection(parameters)
        self.channel = self.connection.channel()
        
        # Declare queues (idempotent)
        self.channel.queue_declare(queue=API_REQUEST_QUEUE, durable=True)
        self.channel.queue_declare(queue=FILE_PROCESSING_QUEUE, durable=True)
    
    def publish_message(self, queue: str, message: Dict[str, Any]):
        """Publish message to specified queue"""
        self.channel.basic_publish(
            exchange='',
            routing_key=queue,
            body=json.dumps(message),
            properties=pika.BasicProperties(
                delivery_mode=2,  # Make message persistent
                content_type='application/json'
            )
        )
    
    def close(self):
        """Close connection"""
        if self.connection and not self.connection.is_closed:
            self.connection.close()


class APIClient:
    """Handles API calls with retry logic"""
    
    def __init__(self):
        self.session = requests.Session()
        
        # Configure retry strategy
        retry_strategy = Retry(
            total=3,
            backoff_factor=2,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET", "POST"]
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        
        # Set default headers
        self.session.headers.update({
            'Authorization': f'Bearer {API_KEY}',
            'Content-Type': 'application/json'
        })
    
    def make_api_call(self, location_id: str, subscriber_id: str, call_number: int) -> Dict[str, Any]:
        """
        Make API call for given location and subscriber
        
        Args:
            location_id: Location identifier
            subscriber_id: Subscriber identifier
            call_number: API call sequence number (1, 2, or 3)
        
        Returns:
            Dict containing API response data
        """
        endpoint = f"{API_BASE_URL}/data"
        
        payload = {
            'location_id': location_id,
            'subscriber_id': subscriber_id,
            'call_sequence': call_number
        }
        
        try:
            response = self.session.post(
                endpoint,
                json=payload,
                timeout=30
            )
            response.raise_for_status()
            return response.json()
        
        except requests.exceptions.RequestException as e:
            print(f"API call failed for {location_id}/{subscriber_id}/call-{call_number}: {str(e)}")
            raise


class CSVFileManager:
    """Manages CSV file operations"""
    
    @staticmethod
    def create_csv_file(location_id: str, subscriber_id: str, data_list: List[Dict[str, Any]]) -> str:
        """
        Create CSV file from API response data
        
        Args:
            location_id: Location identifier
            subscriber_id: Subscriber identifier
            data_list: List of data dictionaries from API calls
        
        Returns:
            Path to created CSV file
        """
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        filename = f"{location_id}_{subscriber_id}_{timestamp}.csv"
        filepath = os.path.join(EFS_MOUNT_PATH, 'pending', filename)
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        
        # Combine all data from 3 API calls
        all_rows = []
        for data in data_list:
            if 'rows' in data:
                all_rows.extend(data['rows'])
        
        if not all_rows:
            raise ValueError("No data rows found in API responses")
        
        # Write to CSV
        with open(filepath, 'w', newline='', encoding='utf-8') as csvfile:
            # Get all unique field names
            fieldnames = set()
            for row in all_rows:
                fieldnames.update(row.keys())
            fieldnames = sorted(list(fieldnames))
            
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(all_rows)
        
        return filepath
    
    @staticmethod
    def get_file_metadata(filepath: str) -> Dict[str, Any]:
        """
        Get metadata for CSV file
        
        Args:
            filepath: Path to CSV file
        
        Returns:
            Dict containing file metadata
        """
        file_size = os.path.getsize(filepath)
        
        # Count rows
        with open(filepath, 'r', encoding='utf-8') as f:
            row_count = sum(1 for _ in f) - 1  # Subtract header
        
        # Calculate checksum
        sha256_hash = hashlib.sha256()
        with open(filepath, 'rb') as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        checksum = sha256_hash.hexdigest()
        
        return {
            'file_size': file_size,
            'row_count': row_count,
            'checksum': checksum
        }
    
    @staticmethod
    def move_to_completed(filepath: str) -> str:
        """
        Move file from pending to completed directory
        
        Args:
            filepath: Current file path
        
        Returns:
            New file path
        """
        filename = os.path.basename(filepath)
        new_path = os.path.join(EFS_MOUNT_PATH, 'completed', filename)
        os.makedirs(os.path.dirname(new_path), exist_ok=True)
        os.rename(filepath, new_path)
        return new_path


def process_message(message_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a single message from the queue
    
    Args:
        message_body: Message containing location_id and subscriber_id
    
    Returns:
        Dict containing file processing information
    """
    request_id = message_body.get('request_id')
    location_id = message_body['location_id']
    subscriber_id = message_body['subscriber_id']
    
    print(f"Processing request {request_id}: Location={location_id}, Subscriber={subscriber_id}")
    
    # Initialize API client
    api_client = APIClient()
    
    # Make 3 API calls
    api_responses = []
    for call_number in range(1, 4):
        print(f"Making API call {call_number}/3 for {location_id}/{subscriber_id}")
        response_data = api_client.make_api_call(location_id, subscriber_id, call_number)
        api_responses.append(response_data)
    
    # Create CSV file
    print(f"Creating CSV file for {location_id}/{subscriber_id}")
    csv_filepath = CSVFileManager.create_csv_file(location_id, subscriber_id, api_responses)
    
    # Get file metadata
    metadata = CSVFileManager.get_file_metadata(csv_filepath)
    
    # Move to completed directory
    final_path = CSVFileManager.move_to_completed(csv_filepath)
    
    print(f"CSV file created: {final_path} ({metadata['row_count']} rows, {metadata['file_size']} bytes)")
    
    # Prepare message for file processing queue
    file_message = {
        'file_id': str(uuid.uuid4()),
        'location_id': location_id,
        'subscriber_id': subscriber_id,
        'efs_path': final_path,
        'file_size': metadata['file_size'],
        'row_count': metadata['row_count'],
        'created_at': datetime.utcnow().isoformat(),
        'checksum': metadata['checksum']
    }
    
    return file_message


def lambda_handler(event, context):
    """
    Lambda handler for RabbitMQ event source
    
    Args:
        event: Lambda event containing RabbitMQ messages
        context: Lambda context
    
    Returns:
        Dict with status code
    """
    rabbitmq_conn = None
    
    try:
        # Initialize RabbitMQ connection
        rabbitmq_conn = RabbitMQConnection()
        
        # Process messages from event
        for record in event.get('rmqMessagesByQueue', {}).get(API_REQUEST_QUEUE, []):
            message_body = json.loads(record['data'])
            
            try:
                # Process the message
                file_message = process_message(message_body)
                
                # Publish to file processing queue
                rabbitmq_conn.publish_message(FILE_PROCESSING_QUEUE, file_message)
                print(f"Published file message: {file_message['file_id']}")
                
            except Exception as e:
                print(f"Error processing message: {str(e)}")
                # Message will be retried or sent to DLQ based on configuration
                raise
        
        return {
            'statusCode': 200,
            'body': json.dumps('Processing completed successfully')
        }
    
    except Exception as e:
        print(f"Lambda execution error: {str(e)}")
        raise
    
    finally:
        if rabbitmq_conn:
            rabbitmq_conn.close()


if __name__ == "__main__":
    # For local testing
    test_event = {
        'rmqMessagesByQueue': {
            API_REQUEST_QUEUE: [
                {
                    'data': json.dumps({
                        'request_id': str(uuid.uuid4()),
                        'location_id': 'LOC001',
                        'subscriber_id': 'SUB001',
                        'api_call_sequence': 1,
                        'timestamp': datetime.utcnow().isoformat(),
                        'retry_count': 0
                    })
                }
            ]
        }
    }
    
    lambda_handler(test_event, None)
