import {aws_iam as iam, aws_s3, aws_ssm as ssm, RemovalPolicy, Stack} from "aws-cdk-lib";
import {Construct} from "constructs";
import {BaseStackProps} from "./props";
import {HttpMethods} from "aws-cdk-lib/aws-s3";

export interface S3StackProps extends BaseStackProps {
    bucketName: string
}

export class S3Stack extends Stack {
    public readonly bucket: aws_s3.Bucket

    constructor(scope: Construct, id: string, props: S3StackProps) {
        super(scope, id, props);

        this.bucket = new aws_s3.Bucket(this, 'createBucket', {
            bucketName: `${props.bucketName}-bucket`,
            versioned: props.stage === 'prd-v0292',
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
            cors: [
                {
                    allowedHeaders: ['*'],
                    allowedMethods: [HttpMethods.PUT, HttpMethods.GET, HttpMethods.POST],
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

        const distArn = ssm.StringParameter.valueForStringParameter(
            this, `/decidim-cfj/${props.stage}/CLOUDFRONT_DISTRIBUTION_ARN`
        );

        this.bucket.addToResourcePolicy(new iam.PolicyStatement({
            sid: "AllowCloudFrontOACRead",
            effect: iam.Effect.ALLOW,
            principals: [ new iam.ServicePrincipal("cloudfront.amazonaws.com") ],
            actions: ["s3:GetObject"],
            resources: [ `${this.bucket.bucketArn}/*` ],
            conditions: { StringEquals: { "AWS:SourceArn": distArn } },
        }));
    }
}
