import {aws_iam as iam, aws_s3, aws_ssm as ssm, Stack} from "aws-cdk-lib";
import { Construct } from "constructs";
import { BaseStackProps } from "./props";

export interface S3PolicyStackProps extends BaseStackProps {
    bucket: aws_s3.Bucket
}

export class S3PolicyStack extends Stack {
  public readonly bucket: aws_s3.Bucket

  constructor(scope: Construct, id: string, props: S3PolicyStackProps) {
    super(scope, id, props);
      const distArn = ssm.StringParameter.valueForStringParameter(
          this, `/decidim-cfj/${props.stage}/CLOUDFRONT_DISTRIBUTION_ARN`
      );

      props.bucket.addToResourcePolicy(new iam.PolicyStatement({
          sid: "AllowCloudFrontOACRead",
          effect: iam.Effect.ALLOW,
          principals: [ new iam.ServicePrincipal("cloudfront.amazonaws.com") ],
          actions: ["s3:GetObject"],
          resources: [ `${props.bucket.bucketArn}/*` ],
          conditions: { StringEquals: { "AWS:SourceArn": distArn } },
      }));
 }
}
