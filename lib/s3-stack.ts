import { aws_cloudfront as cloudfront, aws_iam as iam, aws_s3, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BaseStackProps } from "./props";
import { HttpMethods } from "aws-cdk-lib/aws-s3";

export class S3Stack extends Stack {
  public readonly bucket: aws_s3.Bucket

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);

    const bucket = new aws_s3.Bucket(this, 'createBucket', {
      bucketName: `${ props.stage }-${ props.serviceName }-bucket`,
      versioned: props.stage === 'prd-v0292',
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET, HttpMethods.POST ],
          allowedOrigins: ['*'],
          exposedHeaders: [
            'Origin',
            'Content-Type',
            'Content-MD5',
            'Content-Disposition'
          ],
          maxAge: 3600
        }
      ]
    });

    this.bucket = bucket

    const oai = new cloudfront.OriginAccessIdentity(
      this,
      `${ props.stage }-${ props.serviceName }-OriginAccessIdentity`,
      {
        comment: `${ props.stage }-${ props.serviceName }-OriginAccessIdentity`
      }
    )

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        effect: iam.Effect.ALLOW,
        principals: [
          new iam.CanonicalUserPrincipal(
            oai.cloudFrontOriginAccessIdentityS3CanonicalUserId
          )
        ],
        resources: [`${ bucket.bucketArn }/*`],
      })
    )
  }
}
