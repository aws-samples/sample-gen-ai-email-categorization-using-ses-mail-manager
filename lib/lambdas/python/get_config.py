import os
import ast
import json
import boto3
from botocore.exceptions import ClientError

client = boto3.client('dynamodb')
inbound_email_address = os.environ['INBOUND_EMAIL_ADDRESS']
dynamo_config = os.environ['CONFIGDB_NAME']

def get_config():

    try:
        response = client.get_item(
            TableName=dynamo_config,
            Key={
                'inboundEmailAddress': {
                        'S': inbound_email_address
                }
            }
        )
    except ClientError as e:
        print(f"Error getting item from DynamoDB: {e.response['Error']['Message']}")
        return None
    else:
        if 'Item' in response:
            dynamodb_dict = ast.literal_eval(str(response['Item']))
            json_data = {k: convert_dynamodb_item(v) for k, v in dynamodb_dict.items()}
            json_output = json.dumps(json_data, indent=4)
            print(json_output)
            return json_output
        else:
            print(f"No item found with inboundEmailAddress: {inbound_email_address}")
            return None
            
def convert_dynamodb_item(item):
    if isinstance(item, dict):
        if 'S' in item:
            return item['S']
        if 'N' in item:
            return int(item['N'])
        if 'L' in item:
            return [convert_dynamodb_item(i) for i in item['L']]
        if 'M' in item:
            return {k: convert_dynamodb_item(v) for k, v in item['M'].items()}
    return item