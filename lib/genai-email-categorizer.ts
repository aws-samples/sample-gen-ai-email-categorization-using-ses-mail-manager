// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { readFileSync } from 'fs';
import {Aws, CfnOutput, RemovalPolicy, CfnResource, Stack, StackProps, Duration, CfnParameter, CustomResource, Token} from "aws-cdk-lib";
import {Construct} from "constructs";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import {Function, Runtime, Code} from "aws-cdk-lib/aws-lambda";
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import path = require('path');
import { Queue } from 'aws-cdk-lib/aws-sqs';
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import { NagSuppressions } from 'cdk-nag';
import * as kms from 'aws-cdk-lib/aws-kms';

const llmInstructionsPath = path.join(__dirname, 'llminstructions.txt');
const llmInstructions = readFileSync(llmInstructionsPath, 'utf-8');
export class GenAIEmailCategorizer extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'This is the default Lambda Execution Policy which just grants writes to CloudWatch.'
      }
    ])


    // Stack Input Parameters
    const allowListedEmailAddress = new CfnParameter(this, "allowListedEmailAddress", {
      type: "String",
      description: "The allow listed inbound email address.  This solution will setup an initial Mail Manager Traffic Policy to allow emails to a specific email address.  Please enter an initial email address here.  You can adjust the Traffic Policy as needed following deployment."
    });

    const vadeAddonARN = new CfnParameter(this, "vadeAddonARN", {
      type: "String",
      description: "The allow listed inbound email address.  This solution will setup an initial Mail Manager Traffic Policy to allow emails to a specific email address.  Please enter an initial email address here.  You can adjust the Traffic Policy as needed following deployment."
    });


    // Global Settings DynamoDB Table
    const settingsTable = new dynamodb.Table(this, 'Settings', { 
      partitionKey: { name: 'inboundEmailAddress', type: dynamodb.AttributeType.STRING }, 
      removalPolicy: RemovalPolicy.DESTROY, //TODO Change to Retain before Production
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Email Categories DynamoDB Table
    const emailCategoriesTable = new dynamodb.Table(this, 'EmailCategories', { 
      partitionKey: { name: 'message_id', type: dynamodb.AttributeType.STRING }, 
      removalPolicy: RemovalPolicy.DESTROY, //TODO Change to Retain before Production
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    //log bucket
    const accessLogsBucket = new s3.Bucket(this, "accessLogsBucket", {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: RemovalPolicy.RETAIN, 
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });

    NagSuppressions.addResourceSuppressions(accessLogsBucket, [
        {
          id: 'AwsSolutions-S1',
          reason: 'This is the Log Bucket.'
        },
    ])
    
     // Email Bucket
     const emailBucket = new s3.Bucket(this, "emailBucket", {
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      removalPolicy: RemovalPolicy.DESTROY, //TODO Change to Retain before Production
      autoDeleteObjects: true, //TODO Remove before Production
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      serverAccessLogsBucket: accessLogsBucket,
      serverAccessLogsPrefix: 'emails',
    });

    //Category SNS Topics
    interface CategoryTopic {
      category: string;
      topicName: string;
      topicArn: string;
    }

    interface CategoryQueue {
      category: string;
      queueName: string;
      queueArn: string;
    }
    let categoryTopics: CategoryTopic[] = [];
    let categoryTopicArns: string[] = [];
    let categoryQueues: CategoryQueue[] = [];

    // Create a single Dead Letter Queue for all category queues
    const deadLetterQueue = new Queue(this, 'EmailCategorizerDLQ', {
      visibilityTimeout: Duration.seconds(300),
      retentionPeriod: Duration.days(14)
    });

    // Add policy to enforce HTTPS connections for DLQ
    deadLetterQueue.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.DENY,
      actions: ['sqs:*'],
      resources: [deadLetterQueue.queueArn],
      principals: [new iam.AnyPrincipal()],
      conditions: {
        'Bool': {
          'aws:SecureTransport': 'false'
        }
      }
    }));

    const aws_sns_kms = kms.Alias.fromAliasName(
      this,
      "aws-managed-sns-kms-key",
      "alias/aws/sns",
    )

    const emailCategories = this.node.tryGetContext('emailCategories');
    console.log(emailCategories);
    for (let [index, category] of emailCategories.entries()) {
      console.log(`Creating category topic ${index} for ${category}`);

      const categoryTopic = new sns.Topic(this, `GenAIEmailCategorizer${category}`, {
        topicName: `GenAIEmailCategorizer-${category}`,
        masterKey: aws_sns_kms
      });

      categoryTopics.push({
        category: category,
        topicName: categoryTopic.topicName,
        topicArn: categoryTopic.topicArn
      });
      categoryTopicArns.push(categoryTopic.topicArn);

      const categoryQueue = new Queue(this, `GenAIEmailCategorizer${category}Queue`, {
        visibilityTimeout: Duration.seconds(300),
        deadLetterQueue: {
          queue: deadLetterQueue,
          maxReceiveCount: 3
        }
      });

      // Add policy to enforce HTTPS connections
      categoryQueue.addToResourcePolicy(new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: ['sqs:*'],
        resources: [categoryQueue.queueArn],
        principals: [new iam.AnyPrincipal()],
        conditions: {
          'Bool': {
            'aws:SecureTransport': 'false'
          }
        }
      }));

      categoryQueue.addToResourcePolicy(new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [categoryQueue.queueArn],
        principals: [new iam.ServicePrincipal('sns.amazonaws.com')]
      }));
      
      categoryTopic.addSubscription(new subs.SqsSubscription(categoryQueue, {}));

      categoryQueues.push({
        category: category,
        queueName: categoryQueue.queueName,
        queueArn: categoryQueue.queueArn
      }); 

      //Subscribe Lambda to Category Queue

      const echoSNSToConsoleLambda = new nodeLambda.NodejsFunction(this, `echoSNSToConsole${category}`, {
        runtime: Runtime.NODEJS_22_X,
        entry: 'lib/lambdas/node/echoSNSToConsole.mjs',
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: {
          SQS_QUEUE_URL: categoryQueue.queueUrl
        }
      });
      echoSNSToConsoleLambda.addEventSource(new eventsources.SqsEventSource(categoryQueue, {
        batchSize: 1
      }));
    }

        // CloudWatch Metrics and Alarms
        const jsonMetric = new cloudwatch.Metric({
          namespace: 'GenAIEmailCategorizer',
          metricName: 'LambdaErrors'
        })

        const emailCategorizerLambdaErrorsAlarm = new cloudwatch.Alarm(this, 'EmailCategorizerLambdaErrors', {
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
          threshold: 1,
          evaluationPeriods: 1,
          metric: jsonMetric,
        });

    // Email Processor Lambda
    const emailHandlerLambda = new Function(this, 'emailHandlerLambda', {
        description: "Created By CDK Solution. DO NOT EDIT",
        runtime: Runtime.PYTHON_3_13,
        code: Code.fromAsset(path.join(__dirname, 'lambdas/python'), {
            ////Only needed if you need to bundle external libraries...will require Docker to be installed
            // bundling: {
            //     image: Runtime.PYTHON_3_11.bundlingImage,
            //     command: [
            //         'bash', '-c',
            //         'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output && chmod -R 755 /asset-output',
            //     ],
            // },
        }),
        environment: {
          CONFIGDB_NAME: `${settingsTable.tableName}`,
          LOGGIN_DB: `${emailCategoriesTable.tableName}`,
          INBOUND_EMAIL_ADDRESS: allowListedEmailAddress.valueAsString
        },
        handler: 'index.lambda_handler',
        memorySize: 512,
        reservedConcurrentExecutions: 5,
        timeout: Duration.seconds(60),
    });

    // IAM Policy for Lambda
    emailHandlerLambda.role?.attachInlinePolicy(new iam.Policy(this, 'emailHandlerLambdaPolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:GetObject",
            "s3:ListBucket"
          ],
          resources: [
            emailBucket.bucketArn,
            `${emailBucket.bucketArn}/*`
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "bedrock:InvokeModel"
          ],
          resources: [  
            `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0`,
            `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
            `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-lite-v1:0`,
            `arn:aws:bedrock:${this.region}::foundation-model/amazon.nova-micro-v1:0`
          ] 
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents"
          ],
          resources: ["*"]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "dynamodb:GetItem"
          ],
          resources: [
            `${settingsTable.tableArn}`
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "dynamodb:PutItem"
          ],
          resources: [
            `${emailCategoriesTable.tableArn}`
          ]
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "sns:Publish"
          ],
          resources: categoryTopicArns
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [                
              "cloudwatch:PutMetricData",
          ],
          resources: [`*`]
        }),
      ]
    }));

    NagSuppressions.addResourceSuppressionsByPath(this, `/GenAIEmailCategorizer/emailHandlerLambdaPolicy/Resource`, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'This granting access to all paths in the given bucket. This has been scoped down to the specific bucket in the policy statement above. For CloudWatch Metrics and Alarms there is no way to scope this down to a specific resource.'
      }
    ])

    // S3 Event Source for Lambda
    emailHandlerLambda.addEventSource(new eventsources.S3EventSource(emailBucket, {
      events: [ s3.EventType.OBJECT_CREATED ],
      filters: [ { prefix: `GenAIEmailCategorizerEmails/` } ] 
    }));

    NagSuppressions.addResourceSuppressionsByPath(this, '/GenAIEmailCategorizer/BucketNotificationsHandler050a0587b7544547bf325f094a3db834/Role/DefaultPolicy/Resource', [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'This policy is created automatically when configuring a lambda as and event source for an S3 bucket'
      },
    ])


    //MM IAM Roles
    const mmIAMRole = new iam.Role(this, 'mmIAMRole', {
      assumedBy: new iam.ServicePrincipal('ses.amazonaws.com') 
    });
    
    // Add a policy to a Role
    mmIAMRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [            
          's3:PutObject'
        ],
        resources: [`${emailBucket.bucketArn}/*`],
      })
    );

    NagSuppressions.addResourceSuppressionsByPath(this, `/GenAIEmailCategorizer/mmIAMRole/DefaultPolicy/Resource`, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'This granting access for Mail Manager to write to the S3 bucket. This has been scoped down to the specific bucket in the policy statement above.'
      }
    ])
    
    // No L1/L2 constructs yet, so using escape hatch.
    const mmTrafficPolicy = new CfnResource(this, "mmTrafficPolicy",{
      type: "AWS::SES::MailManagerTrafficPolicy",
      properties: {
        DefaultAction: "DENY",
        PolicyStatements: [
          {
            Action: "ALLOW",
            Conditions: [
              {
                StringExpression:
                {
                  Evaluate: {
                    Attribute: "RECIPIENT"
                  },
                  Operator: "EQUALS",
                  Values:[
                    `${allowListedEmailAddress.valueAsString}`
                  ]
                }
              }
            ]
          }
        ], 
        TrafficPolicyName: "GenAI-Email-Categorizer-Traffic-Policy"
      }
    })

    const mmRuleSet = new CfnResource(this, "mmRuleSet",{
      type: "AWS::SES::MailManagerRuleSet",
      properties: {
        Rules: [
          {
            Name: "vade-scan",
            Conditions:[
              {
                BooleanExpression: {
                  Evaluate: {
                    Analysis: {
                      Analyzer: vadeAddonARN.valueAsString,
                      ResultField: "isPassed"
                    }
                  },
                  Operator: "IS_FALSE"
                }
              }
            ],
            Actions: [
              {
                Drop: {}
              }
            ]
          },
          {
            Name: "write-to-s3",
            Actions: [
              {
                WriteToS3: 
                  {
                  RoleArn: mmIAMRole.roleArn,
                  S3Bucket: emailBucket.bucketName,
                  S3Prefix: `GenAIEmailCategorizerEmails`,
                  ActionFailurePolicy: 'CONTINUE'
                }
              }
            ]
          }
        ],
        RuleSetName: "GenAIEmail-Rule-Set"
      }
    })

    const mmIngressPoint = new CfnResource(this, "mmIngressPoint",{
      type: "AWS::SES::MailManagerIngressPoint",
      properties: {
        IngressPointName: "GenAIEmail-Ingress-Point",
        RuleSetId: mmRuleSet.getAtt("RuleSetId").toString(),
        TrafficPolicyId: mmTrafficPolicy.getAtt("TrafficPolicyId").toString(),
        Type: "OPEN"
      }
    })

    // custom resource lambda
    const customResourceLambda = new nodeLambda.NodejsFunction(this, `CustomResourceLambda`, {
      runtime: Runtime.NODEJS_22_X,
      entry: 'lib/lambdas/node/customResource.mjs',
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: {
        timestamp: new Date().toISOString(), //Forces update
      },
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "dynamodb:PutItem"
          ],
          resources: 
            [
              `${settingsTable.tableArn}`
            ]
        })
      ]
    });

    const defaultDataCustomResource = new CustomResource(this, `defaultSettingsCustomResource`, {
      resourceType: 'Custom::CreateInitialSettings',
      serviceToken: customResourceLambda.functionArn,
      properties: {
        Timestamp: new Date().toISOString(), //Forces update
        TableName: settingsTable.tableName,
        Item: {
              inboundEmailAddress: allowListedEmailAddress.valueAsString,
              bedrockModelID: "amazon.nova-micro-v1:0",
              llmInstructions: llmInstructions,
              llmTemperature: 1,
              categories: emailCategories.valueAsString,
              categoryTopics: categoryTopics,
              LoggingDBName: emailCategoriesTable.tableName
          }
      }
    });

    /**************************************************************************************************************
    * CDK Outputs *
    **************************************************************************************************************/

    new CfnOutput(this, "SettingsDynamoDBTableName", {
      value: settingsTable.tableName
    })

    new CfnOutput(this, "EmailCategoriesDynamoDBTableName", {
      value: emailCategoriesTable.tableName
    })

    new CfnOutput(this, "EmailS3Bucket", {
      value: emailBucket.bucketName
    })

    new CfnOutput(this, "TrafficPolicyID", {
      value: mmTrafficPolicy.getAtt("TrafficPolicyId").toString()
    })

    new CfnOutput(this, "RuleSetID", {
      value: mmRuleSet.getAtt("RuleSetId").toString()
    })

    new CfnOutput(this, "IngressPointID", {
      value: mmIngressPoint.getAtt("IngressPointArn").toString()
    })

    new CfnOutput(this, "ARecord", {
      value: mmIngressPoint.getAtt("ARecord").toString()
    })

    new CfnOutput(this, "EmailCategorizerLambdaErrorsAlarm", {
      value: emailCategorizerLambdaErrorsAlarm.alarmName
    });

  }
}
