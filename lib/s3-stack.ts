import { aws_s3, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BaseStackProps } from "./props";

export class S3Stack extends Stack {
  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);
    
    new aws_s3.Bucket(this, 'createBucket', {
      bucketName: `${ props.stage }-${ props.serviceName }-bucket`,
      versioned: props.stage === "prd",
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

  }
}