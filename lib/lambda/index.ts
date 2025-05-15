import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({ region: process.env.AWS_REGION || "ap-northeast-1" });

export const handler = async (event: any) => {
  const snsEvent = event.Records[0].Sns;
  
  const message = JSON.parse(snsEvent.Message);
  const detail = message.detail;

  const pipeline = detail.pipeline;
  const state = detail.state;
  const time = snsEvent.Timestamp;
  const region = message.region;
  const additionalInformation = message.additionalAttributes.failedActions;
  const failedStage = message.additionalAttributes.failedStage;

  const recipient = process.env.EMAIL_RECIPIENT!;
  const sender = process.env.EMAIL_SENDER!;

  const params = {
    Destination: { ToAddresses: [recipient] },
    Message: {
      Body: {
        Text: {
          Charset: "UTF-8",
          Data: `🚨 Pipeline Failed!

Pipeline: ${pipeline}
State: ${state}
Time: ${time}
Additional Information: ${JSON.stringify(additionalInformation)}
Failed Stage: ${failedStage}

View: https://${region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipeline}/view?region=${region}`,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: `[ALERT] CodePipeline ${pipeline} FAILED`,
      },
    },
    Source: sender,
  };

  await ses.send(new SendEmailCommand(params));
};
