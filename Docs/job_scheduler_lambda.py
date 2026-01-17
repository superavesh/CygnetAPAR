"""
Job Scheduler Lambda Function
Generates and publishes messages to RabbitMQ API request queue
"""

import json
import os
import uuid
from datetime import datetime
from typing import List, Dict, Any
import pika
import psycopg2

# Environment variables
RABBITMQ_HOST = os.environ['RABBITMQ_HOST']
RABBITMQ_PORT = int(os.environ.get('RABBITMQ_PORT', 5672))
RABBITMQ_USERNAME = os.environ['RABBITMQ_USERNAME']
RABBITMQ_PASSWORD = os.environ['RABBITMQ_PASSWORD']
API_REQUEST_QUEUE = os.environ.get('API_REQUEST_QUEUE', 'api_requests_queue')
DB_HOST = os.environ.get('DB_HOST')
DB_PORT = int(os.environ.get('DB_PORT', 5432))
DB_NAME = os.environ.get('DB_NAME')
DB_USERNAME = os.environ.get('DB_USERNAME')
DB_PASSWORD = os.environ.get('DB_PASSWORD')


class RabbitMQPublisher:
    """Manages RabbitMQ connection and publishing"""
    
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
        
        # Declare queue (idempotent)
        self.channel.queue_declare(queue=API_REQUEST_QUEUE, durable=True)
        
        self.published_count = 0
    
    def publish_message(self, message: Dict[str, Any]):
        """
        Publish message to API request queue
        
        Args:
            message: Message dictionary
        """
        self.channel.basic_publish(
            exchange='',
            routing_key=API_REQUEST_QUEUE,
            body=json.dumps(message),
            properties=pika.BasicProperties(
                delivery_mode=2,  # Make message persistent
                content_type='application/json'
            )
        )
        self.published_count += 1
    
    def close(self):
        """Close connection"""
        if self.connection and not self.connection.is_closed:
            self.connection.close()


def get_locations_from_database() -> List[str]:
    """
    Fetch active locations from database
    
    Returns:
        List of location IDs
    """
    if not all([DB_HOST, DB_NAME, DB_USERNAME, DB_PASSWORD]):
        # Return hardcoded locations if database is not configured
        print("Database not configured, using hardcoded locations")
        return ['LOC001', 'LOC002', 'LOC003']
    
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USERNAME,
            password=DB_PASSWORD
        )
        cursor = conn.cursor()
        
        # Adjust query based on your schema
        cursor.execute("""
            SELECT location_id 
            FROM locations 
            WHERE active = true
            ORDER BY location_id
        """)
        
        locations = [row[0] for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        
        return locations
    
    except Exception as e:
        print(f"Error fetching locations from database: {str(e)}")
        # Fallback to hardcoded locations
        return ['LOC001', 'LOC002', 'LOC003']


def get_subscribers_from_database() -> List[str]:
    """
    Fetch active subscribers from database
    
    Returns:
        List of subscriber IDs
    """
    if not all([DB_HOST, DB_NAME, DB_USERNAME, DB_PASSWORD]):
        # Return hardcoded subscribers if database is not configured
        print("Database not configured, using hardcoded subscribers")
        return ['SUB001', 'SUB002', 'SUB003', 'SUB004', 'SUB005']
    
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USERNAME,
            password=DB_PASSWORD
        )
        cursor = conn.cursor()
        
        # Adjust query based on your schema
        cursor.execute("""
            SELECT subscriber_id 
            FROM subscribers 
            WHERE active = true
            ORDER BY subscriber_id
        """)
        
        subscribers = [row[0] for row in cursor.fetchall()]
        
        cursor.close()
        conn.close()
        
        return subscribers
    
    except Exception as e:
        print(f"Error fetching subscribers from database: {str(e)}")
        # Fallback to hardcoded subscribers
        return ['SUB001', 'SUB002', 'SUB003', 'SUB004', 'SUB005']


def get_locations_and_subscribers_from_config(config: Dict[str, Any]) -> tuple:
    """
    Get locations and subscribers from configuration
    
    Args:
        config: Configuration dictionary
    
    Returns:
        Tuple of (locations, subscribers)
    """
    locations = config.get('locations', [])
    subscribers = config.get('subscribers', [])
    
    return locations, subscribers


def generate_api_request_messages(locations: List[str], subscribers: List[str]) -> List[Dict[str, Any]]:
    """
    Generate API request messages for all location-subscriber combinations
    
    Args:
        locations: List of location IDs
        subscribers: List of subscriber IDs
    
    Returns:
        List of message dictionaries
    """
    messages = []
    
    for location in locations:
        for subscriber in subscribers:
            # Create one message per location-subscriber combination
            # The API caller will make 3 API calls for each message
            message = {
                'request_id': str(uuid.uuid4()),
                'location_id': location,
                'subscriber_id': subscriber,
                'timestamp': datetime.utcnow().isoformat(),
                'retry_count': 0
            }
            messages.append(message)
    
    return messages


def publish_messages_to_queue(messages: List[Dict[str, Any]]) -> int:
    """
    Publish messages to RabbitMQ queue
    
    Args:
        messages: List of messages to publish
    
    Returns:
        Number of messages published
    """
    publisher = None
    
    try:
        publisher = RabbitMQPublisher()
        
        for message in messages:
            publisher.publish_message(message)
            
            # Log progress every 100 messages
            if publisher.published_count % 100 == 0:
                print(f"Published {publisher.published_count} messages...")
        
        print(f"Successfully published {publisher.published_count} messages")
        return publisher.published_count
    
    finally:
        if publisher:
            publisher.close()


def lambda_handler(event, context):
    """
    Lambda handler for job scheduling
    
    Trigger sources:
    1. EventBridge Schedule (cron-based)
    2. API Gateway (manual trigger)
    3. S3 Event (configuration file upload)
    
    Args:
        event: Lambda event
        context: Lambda context
    
    Returns:
        Dict with status code and message count
    """
    try:
        print("Starting job scheduler...")
        
        # Determine how to get locations and subscribers
        if 'locations' in event and 'subscribers' in event:
            # Manual trigger with explicit configuration
            locations = event['locations']
            subscribers = event['subscribers']
            print(f"Using locations and subscribers from event")
        
        elif 'Records' in event and event['Records'][0].get('eventSource') == 'aws:s3':
            # S3 trigger - download and parse configuration file
            # This is a placeholder - implement S3 download logic
            print("S3 trigger detected - implement config file parsing")
            locations, subscribers = get_locations_from_database(), get_subscribers_from_database()
        
        else:
            # Default: fetch from database
            locations = get_locations_from_database()
            subscribers = get_subscribers_from_database()
        
        print(f"Found {len(locations)} locations and {len(subscribers)} subscribers")
        
        # Generate messages
        messages = generate_api_request_messages(locations, subscribers)
        total_messages = len(messages)
        
        print(f"Generated {total_messages} API request messages")
        
        # Publish messages to queue
        published_count = publish_messages_to_queue(messages)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Job scheduling completed successfully',
                'locations': len(locations),
                'subscribers': len(subscribers),
                'total_messages': total_messages,
                'published_count': published_count
            })
        }
    
    except Exception as e:
        print(f"Error in job scheduler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'message': 'Job scheduling failed',
                'error': str(e)
            })
        }


if __name__ == "__main__":
    # For local testing
    test_event = {
        'locations': ['LOC001', 'LOC002'],
        'subscribers': ['SUB001', 'SUB002', 'SUB003']
    }
    
    result = lambda_handler(test_event, None)
    print(json.dumps(result, indent=2))
