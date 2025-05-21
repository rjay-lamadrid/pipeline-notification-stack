import * as cdk from "aws-cdk-lib";
import { StackProps, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";

import * as path from "path";
import * as dotenv from "dotenv";

// load config from env file
dotenv.config();

export class PipelineNotificationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const lambdaRole = new iam.Role(this, `lamda-pipeline-alert-role`, {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    });

    // Add SES permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["ses:SendEmail", "ses:SendRawEmail"],
        resources: ["*"],
      })
    );

    // Add CloudWatch logs permissions for logging
    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AWSLambdaBasicExecutionRole"
      )
    );

    // ✅ Lambda function to format and send email
    const notifyLambda = new NodejsFunction(this, `PipelineEventNotifier`, {
      bundling: {
        externalModules: ["aws-sdk"],
        minify: true,
        sourceMap: true,
      },
      functionName: `PipelineEventNotifier`,
      handler: "index.handler",
      entry: path.join(__dirname, "/lambda/index.ts"),
      timeout: Duration.minutes(1),
      memorySize: 1024,
      runtime: Runtime.NODEJS_20_X,
      environment: {
        EMAIL_RECIPIENT: process.env.EMAIL_RECIPIENT as string,
        EMAIL_SENDER: process.env.EMAIL_SENDER as string,
      },
      role: lambdaRole,
    });

    // create SNS topic
    const topic = new sns.Topic(this, "SnsPipelineNotification", {
      topicName: "sns-pipeline-notification",
    });

    // Add the policy manually
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "CodeNotification_publish",
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.ServicePrincipal("codestar-notifications.amazonaws.com"),
        ],
        actions: ["SNS:Publish"],
        resources: [topic.topicArn],
      })
    );

    // Subscribe the Lambda to the topic
    topic.addSubscription(new subs.LambdaSubscription(notifyLambda));

    // Grant SNS permission to invoke the Lambda
    notifyLambda.addPermission("AllowSNSInvoke", {
      principal: new iam.ServicePrincipal("sns.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: topic.topicArn,
    });

    const cloudFormationRule = new events.Rule(
      this,
      "CloudFormationStackStateNotification",
      {
        eventPattern: {
          source: ["aws.cloudformation"],
          detailType: ["CloudFormation Stack Status Change"],
          detail: {
            "status-details": {
              status: [
                "CREATE_IN_PROGRESS",
                "CREATE_COMPLETE",
                "CREATE_FAILED",
                "DELETE_IN_PROGRESS",
                "DELETE_COMPLETE",
                "DELETE_FAILED",
                "UPDATE_IN_PROGRESS",
                "UPDATE_COMPLETE",
                "UPDATE_FAILED",
              ],
            },
          },
        },
      }
    );
    cloudFormationRule.addTarget(new targets.SnsTopic(topic));
  }
}
