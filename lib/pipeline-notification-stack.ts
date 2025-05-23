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

    const pipelineEventRule = new events.Rule(
      this,
      "PipelineEventNotification",
      {
        ruleName: "PipelineEventNotification",
        description: "Pipeline event notification",
        eventPattern: {
          source: ["aws.codepipeline"],
          detail: {
            pipeline: ["MotenasuTrackingPipeline"],
          }
        },
      }
    );
    // Get the underlying CfnRule
    const cfnRule = pipelineEventRule.node.defaultChild as events.CfnRule;

    // Override the EventPattern to include the OR logic
    cfnRule.addPropertyOverride("EventPattern", {
      // OR logic for different event conditions
      $or: [
        // Pipeline execution state changes
        {
          "detail-type": ["CodePipeline Pipeline Execution State Change"],
          detail: {
            state: ["STARTED","SUCCEEDED", "FAILED", "CANCELED", "STOPPED"],
          },
        },
        // Action execution state change for approvals
        {
          "detail-type": ["CodePipeline Action Execution State Change"],
          detail: {
            stage: ["Approval"],
            state: ["STARTED"],
            action: ["Manual_Approval"]
          },
        },
      ],
    });

    pipelineEventRule.addTarget(new targets.LambdaFunction(notifyLambda, {
      retryAttempts: 2,
      maxEventAge: Duration.minutes(1),
    }));

    const cloudFormationRule = new events.Rule(
      this,
      "CloudFormationStackStateNotification",
      {
        ruleName: "CloudFormationStackStateNotification",
        eventPattern: {
          source: ["aws.cloudformation"],
          detailType: ["CloudFormation Stack Status Change"],
          detail: {
            "stack-id": [
              {
                "wildcard": "*motenasu-tracking-stack-*",
              },
            ],
            "status-details": {
              status: [
                "CREATE_COMPLETE",
                "CREATE_FAILED",
                "DELETE_COMPLETE",
                "DELETE_FAILED",
                "UPDATE_COMPLETE",
                "UPDATE_FAILED",
              ],
            },
          },
        },
      }
    );
    cloudFormationRule.addTarget(new targets.LambdaFunction(notifyLambda, {
      retryAttempts: 2,
      maxEventAge: Duration.minutes(1),
    }));
  }
}
