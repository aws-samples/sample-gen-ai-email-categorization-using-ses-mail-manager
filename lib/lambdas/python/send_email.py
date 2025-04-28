import boto3
from botocore.exceptions import ClientError

client = boto3.client('sesv2')

def send_email(email_from, recipient, first_name, category):
    subject = "We have received your email"
    if category == "techsupport":
        incentive = "Please delete the Octank App and re-download from your App Store."
    elif category == "content":
        incentive = "We're excited about all the new content coming to the service in the next few months visit X to learn more."
    elif category == "billing":
        incentive = "We'd like to offer you $5.00 off/month for the remainder of 2024 to thank you for your loyalty."
    else:
        incentive = ""
        
    body_text = f"Dear {first_name},\n\n{incentive}\n\nPlease reply back if you have additional concerns or questions. \n\n Sincerely,\nCustomer Success\nAngryCider"
    
    try:
        response = client.send_email(
            FromEmailAddress=email_from,
            Destination={
                'ToAddresses': [
                    recipient,
                ]
            },
            Content={
                'Simple': {
                    'Subject': {
                        'Data': subject,
                        'Charset': 'UTF-8'
                    },
                    'Body': {
                        'Text': {
                            'Data': body_text,
                            'Charset': 'UTF-8'
                        }
                    }
                }
            }
        )
    except ClientError as e:
        print(f"Error sending email: {e.response['Error']['Message']}")
        return None
    else:
        return response['MessageId'], incentive

