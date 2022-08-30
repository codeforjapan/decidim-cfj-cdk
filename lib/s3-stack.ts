import { aws_s3, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BaseStackProps } from "./props";

export interface S3StackProps extends BaseStackProps {
  bucketName: string
}

export class S3Stack extends Stack {
  constructor(scope: Construct, id: string, props: S3StackProps) {
    super(scope, id, props);
    
    new aws_s3.Bucket(this, 'createBucket', {
      bucketName: props.bucketName,
      versioned: props.stage === "prd",
      removalPolicy: RemovalPolicy.DESTROY
    });

  }
}