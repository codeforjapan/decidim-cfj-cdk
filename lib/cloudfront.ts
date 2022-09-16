import { aws_certificatemanager, aws_cloudfront as cloudfront, aws_cloudfront_origins, Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BaseStackProps } from "./props";
import { AllowedMethods, CachePolicy, OriginRequestPolicy, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";

export interface CloudFrontProps extends BaseStackProps {
  certificateArn: string
  domain: string
}

export class CloudFrontStack extends Stack {
  constructor(scope: Construct, id: string, props: CloudFrontProps) {
    super(scope, id, props);
    const endpoint = `${ props.stage }-${ props.serviceName }-alb-origin.${ props.domain }`;
    const origin = new aws_cloudfront_origins.HttpOrigin(endpoint)
    origin.bind(this, {originId: "defaultEndPoint"})

    new cloudfront.Distribution(this, 'Distribution', {
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultBehavior: {
        origin: origin,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER
      },
      comment: `${ props.stage }-${ props.serviceName }-cloudfront`,
      domainNames: [endpoint],
      certificate: aws_certificatemanager.Certificate.fromCertificateArn(this, 'cloudFrontCertificate', props.certificateArn)
    }).addBehavior('decidim-packs/*', origin, {
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      viewerProtocolPolicy:ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED
    })
  }
}
