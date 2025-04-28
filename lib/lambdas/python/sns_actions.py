import boto3
import json

sns = boto3.client('sns')

def publish_to_sns(complaint, category_result, category_topics):
    """
    Publishes the complaint object to the appropriate SNS topic based on the category.
    """
    topic_arn = None
    for topic in category_topics:
        if topic['category'] == category_result:
            topic_arn = topic['topicArn']
            break

    # If no specific category matches, use the 'unknown' topic
    if not topic_arn:
        for topic in category_topics:
            if topic['category'] == 'unknown':
                topic_arn = topic['topicArn']
                break

    if topic_arn:
        try:
            sns.publish(
                TopicArn=topic_arn,
                Message=json.dumps(complaint),
                Subject=f"Email Complaint Categorized: {category_result}"
            )
            print(f"Published to SNS Topic: {topic_arn}")
        except Exception as e:
            print(f"Failed to publish to SNS: {str(e)}")
    else:
        print("No matching SNS topic found.")