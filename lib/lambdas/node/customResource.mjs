const crypto = require('crypto');
var cfnResponse = require('cfn-response');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const dynamoDBClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocument.from(dynamoDBClient);

/****************
 * Helper Functions
****************/
async function putInitialSettings(tableName, item) {
    const params = {
        TableName : tableName,
        Item: item
    }

    try {
        const results = await ddbDocClient.put(params);
        return results
    } catch (error) {
        console.error('DynamoDb.put: ', error);
        return error
    }
}

/****************
 * Main
****************/
export async function handler(event, context) {
    console.log('Received event:', JSON.stringify(event, null, 2));

    const props = event.ResourceProperties
    const requestType = event.RequestType
    let physicalId = event.PhysicalResourceId

    if (requestType === 'Create') {
        physicalId = `vce.config.${crypto.randomUUID()}`
    } else if(!physicalId) {
        await sendResponse(event, context, 'FAILED', `invalid request: request type is '${requestType}' but 'PhysicalResourceId' is not defined`)
    }

    try{

      switch (event.ResourceType){
        case 'Custom::CreateInitialSettings':
            if (requestType === 'Create' || requestType === 'Update'){
                const putSettingsResults = await putInitialSettings(props.TableName, props.Item);
                console.info('Put Settings Result: ', putSettingsResults);
                await sendResponse(event, context, 'SUCCESS', {});
            } else if(requestType === 'Delete'){
                await sendResponse(event, context, 'SUCCESS', {});
            } else {
                await sendResponse(event, context, 'SUCCESS', {});
            }
            break;
        default:
            await sendResponse(event, context, 'SUCCESS', {});
            break;
      }
    }
    catch (ex){
      console.log(ex);
      await sendResponse(event, context, 'SUCCESS', {}); //TODO changed to FAILED when finished testing.
    }
};

const sendResponse = async (event, context, status, data) => {
  await new Promise(() => cfnResponse.send(event, context, status, data));
  return;
};
