import os
import json
import boto3
from botocore.exceptions import ClientError

client = boto3.client('dynamodb')
dynamo_config = os.environ['LOGGIN_DB']

def log_activity(message_id, complaint):
    try:
        item = {
            'message_id': {'S': message_id}
        }
        
        for key, value in complaint.items():
            if isinstance(value, str):
                item[key] = {'S': value}
            elif isinstance(value, bool):
                item[key] = {'BOOL': value}
            elif isinstance(value, (int, float)):
                item[key] = {'N': str(value)}
            # You can add more type checks if needed
        
        response = client.put_item(
            TableName=dynamo_config,
            Item=item
        )
        
        return response
    except ClientError as e:
        print(f"An error occurred: {e.response['Error']['Message']}")
        return None
