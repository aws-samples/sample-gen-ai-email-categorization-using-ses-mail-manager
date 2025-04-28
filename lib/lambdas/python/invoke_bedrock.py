import json
import boto3
from botocore.exceptions import ClientError
import time

client = boto3.client("bedrock-runtime")

def invoke_bedrock(bedrockModelID, llmTemperature, prompt, instructions, retries=3, backoff_in_seconds=2):
    # Check if we're using an Amazon model or Anthropic model
    is_amazon_model = bedrockModelID.startswith("amazon.")
    
    if is_amazon_model:
        # Format for Amazon models (Nova Micro, Nova Lite)
        # Nova Micro has a smaller context window, so we use a more conservative token limit
        max_tokens = 1024 if "nova-micro" in bedrockModelID else 2048
        messages = [{"role": "user", "content": [{"text": prompt}]}]

        inference_params = {
            "maxTokens": max_tokens,
            "temperature": llmTemperature,
            "topP": 0.8
        }

        native_request = {
            "schemaVersion": "messages-v1",
            "messages": messages,
            "system": [{"text": instructions}],
            "inferenceConfig": inference_params
        }
    else:
        # Format for Anthropic models (Claude)
        native_request = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 2048,
            "temperature": llmTemperature,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": instructions},
                        {"type": "text", "text": prompt}
                    ],
                }
            ],
        }
    
    request = json.dumps(native_request)

    for attempt in range(retries):
        try:
            response = client.invoke_model(modelId=bedrockModelID, body=request)
            model_response = json.loads(response['body'].read().decode('utf-8'))
            
            if is_amazon_model:
                # Handle Amazon model response
                output_text = model_response['output']['message']['content'][0]['text']
                try:
                    output_data = json.loads(output_text)
                    if isinstance(output_data, list):
                        return output_data
                    else:
                        return [output_data]
                except json.JSONDecodeError:
                    # If the response isn't valid JSON, return it as a single item
                    return [{"category": "unknown", "urgency": "non-urgent", "summary": output_text}]
            else:
                # Handle Anthropic model response
                content = model_response.get("content", [])
                if content and content[0].get("text"):
                    output_data = json.loads(content[0]["text"])
                    if isinstance(output_data, list):
                        return output_data
                    else:
                        return [output_data]
                else:
                    raise ValueError("Empty or invalid response content from Bedrock service")

        except (ClientError, ValueError, json.JSONDecodeError) as e:
            if attempt < retries - 1:
                print(f"Attempt {attempt + 1} failed: {e}. Retrying in {backoff_in_seconds ** (attempt + 1)} seconds...")
                time.sleep(backoff_in_seconds ** (attempt + 1))
            else:
                print(f"ERROR: Can't invoke '{bedrockModelID}' after {retries} attempts. Reason: {e}")
                return {
                    'statusCode': 500,
                    'body': json.dumps({"error": str(e)})
                }

