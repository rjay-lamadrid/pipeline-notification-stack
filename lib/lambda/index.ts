import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";

const region = process.env.AWS_REGION || "ap-northeast-1";
const ses = new SESClient({
  region: region,
});

export const handler = async (event: any) => {
  console.log("Event", JSON.stringify(event, null, 2));
  const snsEvent = event.Records[0].Sns;

  let subject = "";
  let data = null;

  const message = JSON.parse(snsEvent.Message);
  if (message.approval) {
    const detail = message.approval;
    data = {
      pipeline: detail.pipelineName,
      expires: detail.expires,
      approvalReviewLink: detail.approvalReviewLink,
      message: detail.customData,
      region: message.region,
      time: snsEvent.Timestamp,
      type: "approval",
    };

    subject = snsEvent.Subject;
    return sendEmail(data, subject);
  }

  const detail = message.detail;
  switch (message.source) {
    case "aws.codepipeline":
      data = {
        pipeline: detail.pipeline,
        state: detail.state,
        time: snsEvent.Timestamp,
        region: message.region,
        type: "state",
      };

      if (data.state === "FAILED") {
        data = {
          ...data,
          additionalInformation:
            message.additionalAttributes.failedActions[0].additionalInformation,
          failedStage: message.additionalAttributes.failedStage,
        };
      }

      subject = `[ALERT] CodePipeline ${data.pipeline} ${data.state}`;
      break;
    case "aws.cloudformation":
      data = {
        stackId: detail["stack-id"],
        status: detail["status-details"].status,
        timestamp: message.time,
        region: message.region,
        type: "cloudformation",
      };
      subject = `[ALERT] CloudFormation ${message["detail-type"]} - ${data.status}`;
      break;
    default:
      break;
  }

  return sendEmail(data, subject);
};

async function sendEmail(data: any, subject: string): Promise<void> {
  if (!data) return;

  const recipient = process.env.EMAIL_RECIPIENT!;
  const sender = process.env.EMAIL_SENDER!;

  let emailContent = "";
  switch (data.type) {
    case "approval":
      emailContent = pipelineApprovalContent(data);
      break;
    case "state":
      emailContent = pipelineStateContent(data);
      break;
    case "cloudformation":
      return;
      emailContent = cloudFormationState(data);
      break;
    default:
      return;
  }

  const params = {
    Destination: { ToAddresses: [recipient] },
    Message: {
      Body: {
        Text: {
          Charset: "UTF-8",
          Data: emailContent,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
    },
    Source: sender,
  };

  //console.log("Sending email", JSON.stringify(params, null, 2));
  await ses.send(new SendEmailCommand(params));
}

function pipelineStateContent(data: any): string {
  return `
    🚨 Pipeline ${data.state}!

    --Pipeline Details--

    Pipeline: ${data.pipeline}
    State: ${data.state}
    Time: ${data.time}
    ${
      data.additionalInformation
        ? `Additional Information: ${data.additionalInformation}`
        : ""
    }
    ${data.failedStage ? `Failed Stage: ${data.failedStage}` : ""}

    View: https://${
      data.region
    }.console.aws.amazon.com/codesuite/codepipeline/pipelines/${
    data.pipeline
  }/view?region=${data.region}`;
}

function pipelineApprovalContent(data: any): string {
  return `
    Hello,

    The following Approval action is waiting for your response:

    --Pipeline Details--

    Pipeline: ${data.pipeline}
    Time: ${data.time}
    
    --Approval Details--

    Approval details: ${data.message}
    Approval review link: ${data.approvalReviewLink}
    Deadline: This review request will expire on ${data.expires}

    View: https://${data.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${data.pipeline}/view?region=${data.region}`;
}

function cloudFormationState(data: any): string {
  return `
    Hello,

    The following CloudFormation stack state changed:
    
    ResourceType: AWS::CloudFormation::Stack
    StackId: ${data.stackId}
    ResourceStatus: ${data.status}
    Timestamp: ${data.timestamp}

    --Additional Information--
    Cloudformation Stack: https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/stackinfo?stackId=${data.stackId}
  `;
}
