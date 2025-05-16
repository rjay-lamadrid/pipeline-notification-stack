import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({
  region: process.env.AWS_REGION || "ap-northeast-1",
});

export const handler = async (event: any) => {
  console.log("Event", JSON.stringify(event, null, 2));
  const snsEvent = event.Records[0].Sns;

  const message = JSON.parse(snsEvent.Message);

  let subject = "";
  let data = null;

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
    }

    subject = snsEvent.Subject;
  }

  if (message.detail) {
    const detail = message.detail;

    data = {
      pipeline: detail.pipeline,
      state: detail.state,
      time: snsEvent.Timestamp,
      region: message.region,
      type: "state",
    }

    if (data.state === "FAILED") {
      data = {
        ...data,
        additionalInformation: message.additionalAttributes.failedActions[0].additionalInformation,
        failedStage: message.additionalAttributes.failedStage,
      }
    }

    subject = `[ALERT] CodePipeline ${data.pipeline} ${data.state}`;
  }

  if (!data) throw new Error("No data found");

  const recipient = process.env.EMAIL_RECIPIENT!;
  const sender = process.env.EMAIL_SENDER!;

  const emailContent = data.type === "approval"
    ? pipelineApprovalContent(data)
    : pipelineStateContent(data);

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
console.log(JSON.stringify(params));
  await ses.send(new SendEmailCommand(params));
};

function pipelineStateContent(data: any): string {
  return `
    🚨 Pipeline ${data.state}!

    --Pipeline Details--

    Pipeline: ${data.pipeline}
    State: ${data.state}
    Time: ${data.time}
    ${data.additionalInformation ? `Additional Information: ${data.additionalInformation}` : ""}
    ${data.failedStage ? `Failed Stage: ${data.failedStage}` : ""}

    View: https://${data.region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${data.pipeline}/view?region=${data.region}`;
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
