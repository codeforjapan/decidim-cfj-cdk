import {
  aws_certificatemanager,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins,
  aws_wafv2,
  Stack
} from "aws-cdk-lib";
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
    origin.bind(this, { originId: "defaultEndPoint" })

    const rules: any[] = [
      {
        name: `${ props.stage }-${ props.serviceName }-AWSManagedRulesCommonRuleSet`,
        priority: 1,
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesCommonRuleSet",
            excludedRules: [
              { name: 'CrossSiteScripting_BODY' },
              { name: 'SizeRestrictions_BODY' },
              { name: 'GenericRFI_BODY' }
            ]
          },
        },
        overrideAction: { none: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `${ props.stage }-${ props.serviceName }-AWSManagedRulesCommonRuleSet`,
        },
      },
      {
        name: `${ props.stage }-${ props.serviceName }-AWSManagedRulesKnownBadInputsRuleSet`,
        priority: 2,
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesKnownBadInputsRuleSet",
          },
        },
        overrideAction: { none: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `${ props.stage }-${ props.serviceName }-AWSManagedRulesKnownBadInputsRuleSet`,
        },
      },
      {
        name: `${ props.stage }-${ props.serviceName }-AWSManagedRulesAmazonIpReputationList`,
        priority: 3,
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesAmazonIpReputationList",
          },
        },
        overrideAction: { none: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `${ props.stage }-${ props.serviceName }-AWSManagedRulesAmazonIpReputationList`,
        },
      },
      {
        name: `${ props.stage }-${ props.serviceName }-AWSManagedRulesLinuxRuleSet`,
        priority: 4,
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesLinuxRuleSet",
          },
        },
        overrideAction: { none: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `${ props.stage }-${ props.serviceName }-AWSManagedRulesLinuxRuleSet`,
        },
      },
      {
        name: `${ props.stage }-${ props.serviceName }-AWSManagedRulesSQLiRuleSet`,
        priority: 5,
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesSQLiRuleSet",
            excludedRules: [
              { name: 'SQLi_BODY' }
            ]
          },
        },
        overrideAction: { none: {} },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `${ props.stage }-${ props.serviceName }-AWSManagedRulesSQLiRuleSet`,
        },
      },
      {
        name: `${ props.stage }-${ props.serviceName }-AllowSystemLogin`,
        priority: 6,
        statement: {
          andStatement: {
            statements: [{
              byteMatchStatement: {
                searchString: `${ props.stage }-${ props.serviceName }-alb-origin`,
                fieldToMatch: {
                  singleHeader: {
                    name: 'host'
                  }
                },
                textTransformations: [
                  {
                    priority: 0,
                    type: 'LOWERCASE'
                  }
                ],
                positionalConstraint: "EXACTLY"
              }
            },
              {
                byteMatchStatement: {
                  searchString: "system/admins/sign_in",
                  fieldToMatch: {
                    uriPath: {}
                  },
                  textTransformations: [
                    {
                      priority: 0,
                      type: 'LOWERCASE'
                    }
                  ],
                  positionalConstraint: "CONTAINS"
                }
              }
            ]
          }
        },
        action: {
          allow: {}
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `${ props.stage }-${ props.serviceName }-AllowSystemLogin`,
        },
      }
    ]

    if (props.stage === 'prd-v0264') {
      rules.push({
        name: 'production-AllowSystemLogin',
        priority: 7,
        statement: {
          andStatement: {
            statements: [{
              byteMatchStatement: {
                searchString: 'production.diycities.jp',
                fieldToMatch: {
                  singleHeader: {
                    name: 'host'
                  }
                },
                textTransformations: [
                  {
                    priority: 0,
                    type: 'LOWERCASE'
                  }
                ],
                positionalConstraint: "EXACTLY"
              }
            },
              {
                byteMatchStatement: {
                  searchString: "system/admins/sign_in",
                  fieldToMatch: {
                    uriPath: {}
                  },
                  textTransformations: [
                    {
                      priority: 0,
                      type: 'LOWERCASE'
                    }
                  ],
                  positionalConstraint: "CONTAINS"
                }
              }
            ]
          }
        },
        action: {
          allow: {}
        },
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `production-AllowSystemLogin`,
        },
      })
    }

    rules.push({
      name: `${ props.stage }-${ props.serviceName }-SystemLoginBlock`,
      priority: 8,
      statement: {
        byteMatchStatement: {
          searchString: 'system/admins/sign_in',
          fieldToMatch: {
            uriPath: {}
          },
          textTransformations: [
            {
              priority: 0,
              type: "LOWERCASE"
            }
          ],
          positionalConstraint: "CONTAINS"
        }
      },
      action: {
        block: {
          customResponse: {
            responseCode: 403,
            customResponseBodyKey: "disable-action"
          }
        }
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: `${ props.stage }-${ props.serviceName }-AllowSystemLogin`,
      },
    })

    const waf: aws_wafv2.CfnWebACL = new aws_wafv2.CfnWebACL(this, "CfnWebACL", {
        name: `${ props.stage }-${ props.serviceName }-webAcl`,
        defaultAction: { allow: {} },
        scope: "CLOUDFRONT",
        visibilityConfig: {
          cloudWatchMetricsEnabled: true,
          sampledRequestsEnabled: true,
          metricName: `${ props.stage }-${ props.serviceName }-webAcl-metrics`
        },
        description: `Web ACL for ${ props.stage }-${ props.serviceName }-cloudfront`,
        rules: rules,
        customResponseBodies: {
          'disable-action': {
            content: '<div>error: access denied</div>',
            contentType: 'TEXT_HTML'
          }
        }
      }
    )

    if (props.stage === "prd-v0264") {
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
        domainNames: [endpoint, `*.${ props.domain }`],
        certificate: aws_certificatemanager.Certificate.fromCertificateArn(this, 'cloudFrontCertificate', props.certificateArn),
        webAclId: waf.attrArn
      }).addBehavior('decidim-packs/*', origin, {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED
      })
    } else {
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
        certificate: aws_certificatemanager.Certificate.fromCertificateArn(this, 'cloudFrontCertificate', props.certificateArn),
        webAclId: waf.attrArn
      }).addBehavior('decidim-packs/*', origin, {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED
      })
    }
  }
}
