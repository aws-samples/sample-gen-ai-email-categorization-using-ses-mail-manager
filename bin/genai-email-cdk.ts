#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GenAIEmailCategorizer } from '../lib/genai-email-categorizer';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))  //Comment this line to bypass cdk-nag

new GenAIEmailCategorizer(app, 'GenAIEmailCategorizer', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  description : "Guidance for GenAI Email Categorization using Amazon Simple Email  Services Mail Manger and Amazon Bedrock(SXXXXX)"
});
