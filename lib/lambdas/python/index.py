import boto3
import json
from urllib.parse import urlparse
from datetime import datetime, timezone
from get_content import get_email_content
from invoke_bedrock import invoke_bedrock
from sns_actions import publish_to_sns
from get_config import get_config
from log_activity import log_activity

s3 = boto3.client('s3')
cloudwatch = boto3.client('cloudwatch')

def log_error_metric(namespace, errorName, count = 1):
    # Put the metric data
    response = cloudwatch.put_metric_data(
        Namespace=namespace,
        MetricData=[
            {
                'MetricName': errorName,
                'Value': count,
                'Unit': 'Count',
                'Timestamp': datetime.UTC()
            }
        ]
    )

    return {
        'statusCode': 200,
        'body': f'Metric {errorName} logged successfully'
    }

def lambda_handler(event, context):
    print(event)

    # Get config from the DynamoDB config
    config = json.loads(get_config())
    bedrockModelID = config.get('bedrockModelID', None)
    llmTemperature = int(config.get('llmTemperature', None))
    instructions = config.get('llmInstructions', None)
    category_topics = config.get('categoryTopics', [])
    
    # Process all records in batches
    batch_size = 10  # Process up to 10 emails at once
    email_batch = []
    message_ids = []
    try:
        for record in event['Records']:
            bucket_name = record['s3']['bucket']['name']
            file_key = record['s3']['object']['key']
            response = s3.get_object(Bucket=bucket_name, Key=file_key)
            file_content = response['Body'].read().decode('utf-8')
        
            # Get the sender's email address and concatenate the subject, email content html or text
            email_content, sender_email, subject = get_email_content(file_content)
            
            # Create a unique message ID from the file key
            message_id = file_key.split('/')[-1]
            
            # Add to batch
            email_batch.append({
                "messageId": message_id,
                "email": email_content,
                "subject": subject
            })
            message_ids.append(message_id)
            
            # Process batch when it reaches the batch size or on the last record
            if len(email_batch) >= batch_size or record == event['Records'][-1]:
                # Prepare the batch prompt
                batch_prompt = json.dumps(email_batch)
                print(batch_prompt)
                
                # Process the batch with Bedrock
                batch_results = invoke_bedrock(bedrockModelID, llmTemperature, batch_prompt, instructions)
                
                # Process each result and publish to SNS
                for i, result in enumerate(batch_results):
                    message_id = message_ids[i]
                    category_result = result.get("category", "unknown")
                    urgency = result.get("urgency", "non-urgent")
                    
                    # Create object for logging
                    complaint = {
                        "messageId": message_id,
                        "category": category_result,
                        "urgency": urgency,
                        "email_address": sender_email,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "email_content": email_content,
                        "summary": result.get("summary", "")
                    }
                    
                    # Publish the complaint to SNS using the helper function
                    publish_to_sns(complaint, category_result, category_topics)
                    print(complaint)

                    # Log the complaint to the DynamoDB table
                    log_activity(message_id, complaint)
                
                # Clear the batch for the next iteration
                email_batch = []
                message_ids = []
    except Exception as e:
        log_error_metric('GenAIEmailCategorizer', 'LambdaErrors')
        print(e)
        raise e

