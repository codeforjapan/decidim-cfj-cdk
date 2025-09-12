import {
    aws_certificatemanager,
    aws_cloudfront as cloudfront,
    aws_cloudfront_origins,
    aws_s3,
    aws_wafv2,
    CfnOutput, RemovalPolicy,
    Stack
} from "aws-cdk-lib";
import {Construct} from "constructs";
import {BaseStackProps} from "./props";
import {AllowedMethods, CachePolicy, OriginRequestPolicy, ViewerProtocolPolicy} from "aws-cdk-lib/aws-cloudfront";
import {AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId} from "aws-cdk-lib/custom-resources";

export interface CloudFrontProps extends BaseStackProps {
    certificateArn: string
    domain: string
    s3BucketName: string
}

export class CloudFrontStack extends Stack {
    public readonly cloudfrontEndpoint: string;
    public readonly cloudfrontOacId: string;

    constructor(scope: Construct, id: string, props: CloudFrontProps) {
        super(scope, id, props);
        const endpoint = `${props.stage}-${props.serviceName}-alb-origin.${props.domain}`;
        const albOrigin = new aws_cloudfront_origins.HttpOrigin(endpoint)
        albOrigin.bind(this, {originId: "defaultEndPoint"})

        // CloudFrontでOACを作成
        const originAccessControl = new cloudfront.S3OriginAccessControl(
            this,
            `${props.stage}-${props.serviceName}-OriginAccessControl`,
            {
                description: `${props.stage}-${props.serviceName}-OriginAccessControl`
            }
        )

        const s3Bucket = aws_s3.Bucket.fromBucketAttributes(this, `${props.stage}-${props.serviceName}-S3Bucket`, {
            bucketName: props.s3BucketName,
            bucketArn: `arn:aws:s3:::${props.s3BucketName}`,
            region: 'ap-northeast-1',
            bucketRegionalDomainName: `${props.s3BucketName}.s3.ap-northeast-1.amazonaws.com`,
        });

        this.cloudfrontOacId = originAccessControl.originAccessControlId

        // S3オリジンの追加
        const s3Origin = aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(s3Bucket, {
            originAccessControl
        })

        const rules: any[] = [
            {
                name: `${props.stage}-${props.serviceName}-AWSManagedRulesCommonRuleSet`,
                priority: 1,
                statement: {
                    managedRuleGroupStatement: {
                        vendorName: "AWS",
                        name: "AWSManagedRulesCommonRuleSet",
                        excludedRules: [
                            {name: 'CrossSiteScripting_BODY'},
                            {name: 'SizeRestrictions_BODY'},
                            {name: 'GenericRFI_BODY'}
                        ]
                    },
                },
                overrideAction: {none: {}},
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    sampledRequestsEnabled: true,
                    metricName: `${props.stage}-${props.serviceName}-AWSManagedRulesCommonRuleSet`,
                },
            },
            {
                name: `${props.stage}-${props.serviceName}-AWSManagedRulesKnownBadInputsRuleSet`,
                priority: 2,
                statement: {
                    managedRuleGroupStatement: {
                        vendorName: "AWS",
                        name: "AWSManagedRulesKnownBadInputsRuleSet",
                    },
                },
                overrideAction: {none: {}},
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    sampledRequestsEnabled: true,
                    metricName: `${props.stage}-${props.serviceName}-AWSManagedRulesKnownBadInputsRuleSet`,
                },
            },
            {
                name: `${props.stage}-${props.serviceName}-AWSManagedRulesAmazonIpReputationList`,
                priority: 3,
                statement: {
                    managedRuleGroupStatement: {
                        vendorName: "AWS",
                        name: "AWSManagedRulesAmazonIpReputationList",
                    },
                },
                overrideAction: {none: {}},
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    sampledRequestsEnabled: true,
                    metricName: `${props.stage}-${props.serviceName}-AWSManagedRulesAmazonIpReputationList`,
                },
            },
            {
                name: `${props.stage}-${props.serviceName}-AWSManagedRulesLinuxRuleSet`,
                priority: 4,
                statement: {
                    managedRuleGroupStatement: {
                        vendorName: "AWS",
                        name: "AWSManagedRulesLinuxRuleSet",
                    },
                },
                overrideAction: {none: {}},
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    sampledRequestsEnabled: true,
                    metricName: `${props.stage}-${props.serviceName}-AWSManagedRulesLinuxRuleSet`,
                },
            },
            {
                name: `${props.stage}-${props.serviceName}-AWSManagedRulesSQLiRuleSet`,
                priority: 5,
                statement: {
                    managedRuleGroupStatement: {
                        vendorName: "AWS",
                        name: "AWSManagedRulesSQLiRuleSet",
                        excludedRules: [
                            {name: 'SQLi_BODY'}
                        ]
                    },
                },
                overrideAction: {none: {}},
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    sampledRequestsEnabled: true,
                    metricName: `${props.stage}-${props.serviceName}-AWSManagedRulesSQLiRuleSet`,
                },
            },
            {
                name: `${props.stage}-${props.serviceName}-AllowSystemLogin`,
                priority: 6,
                statement: {
                    andStatement: {
                        statements: [{
                            byteMatchStatement: {
                                searchString: `${props.stage}-${props.serviceName}-alb-origin`,
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
                    metricName: `${props.stage}-${props.serviceName}-AllowSystemLogin`,
                },
            }
        ]

        if (props.stage === 'prd-v0292') {
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
        } else {
            rules.push({
                name: `${props.stage}-${props.serviceName}-BlockAllBots`,
                priority: 7,
                statement: {
                    managedRuleGroupStatement: {
                        vendorName: "AWS",
                        name: "AWSManagedRulesBotControlRuleSet",
                        managedRuleGroupConfigs: [
                            {
                                awsManagedRulesBotControlRuleSet: {
                                    inspectionLevel: "TARGETED",
                                    enableMachineLearning: true,
                                }
                            }
                        ]
                    },
                },
                overrideAction: {none: {}},
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    sampledRequestsEnabled: true,
                    metricName: `${props.stage}-${props.serviceName}-BlockAllBots`,
                },
            });
        }

        rules.push({
            name: `${props.stage}-${props.serviceName}-SystemLoginBlock`,
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
                metricName: `${props.stage}-${props.serviceName}-AllowSystemLogin`,
            },
        })

        const waf: aws_wafv2.CfnWebACL = new aws_wafv2.CfnWebACL(this, "CfnWebACL", {
                name: `${props.stage}-${props.serviceName}-webAcl`,
                defaultAction: {allow: {}},
                scope: "CLOUDFRONT",
                visibilityConfig: {
                    cloudWatchMetricsEnabled: true,
                    sampledRequestsEnabled: true,
                    metricName: `${props.stage}-${props.serviceName}-webAcl-metrics`
                },
                description: `Web ACL for ${props.stage}-${props.serviceName}-cloudfront`,
                rules: rules,
                customResponseBodies: {
                    'disable-action': {
                        content: '<div>error: access denied</div>',
                        contentType: 'TEXT_HTML'
                    }
                }
            }
        )

        let distribution: cloudfront.Distribution;

        const stripS3PrefixFn = new cloudfront.Function(this, 'StripS3PrefixFn', {
            code: cloudfront.FunctionCode.fromInline(`
                function handler(event) {
                  var req = event.request;
                  req.headers['x-cf-uri-rewrite'] = { value: 'strip-s3-prefix' };
                  req.headers['x-cf-func'] = { value: 'strip-s3-prefix' };
                  if (!req || !req.uri) return req;
                  if (req.uri.startsWith('/s3/')) {
                    var rest = req.uri.substring(4); // "/s3/"
                    req.uri = ('/' + rest).replace(/\\/+/g, '/'); // // を 1本に
                  }
                  return req;
                }
                  `),
        });

        // ALB Log
        const logBucket = new aws_s3.Bucket(this, `${props.stage}AlbLogBucket`, {
            objectOwnership: aws_s3.ObjectOwnership.OBJECT_WRITER,
            blockPublicAccess: aws_s3.BlockPublicAccess.BLOCK_ALL,
            bucketName: `${props.s3BucketName}-cloudfront-logs`,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        })

        if (props.stage === 'prd-v0292') {
            distribution = new cloudfront.Distribution(this, 'Distribution', {
                priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
                defaultBehavior: {
                    origin: albOrigin,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: CachePolicy.CACHING_DISABLED,
                    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER
                },
                comment: `${props.stage}-${props.serviceName}-cloudfront`,
                domainNames: [endpoint, `*.${props.domain}`],
                certificate: aws_certificatemanager.Certificate.fromCertificateArn(this, 'cloudFrontCertificate', props.certificateArn),
                webAclId: waf.attrArn,
                enableLogging: true,
                logBucket: logBucket,
                logFilePrefix: 'cloudfront-logs/',
            });

            // 既存のビヘイビア
            distribution.addBehavior('decidim-packs/*', albOrigin, {
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: CachePolicy.CACHING_OPTIMIZED
            });

            // S3画像アクセス用のビヘイビア
            distribution.addBehavior('/s3/*', s3Origin, {
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
                cachePolicy: CachePolicy.CACHING_OPTIMIZED,
                originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
                functionAssociations: [{
                    function: stripS3PrefixFn,
                    eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                }]
            });
        } else {
            distribution = new cloudfront.Distribution(this, 'Distribution', {
                priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
                defaultBehavior: {
                    origin: albOrigin,
                    allowedMethods: AllowedMethods.ALLOW_ALL,
                    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    cachePolicy: CachePolicy.CACHING_DISABLED,
                    originRequestPolicy: OriginRequestPolicy.ALL_VIEWER
                },
                comment: `${props.stage}-${props.serviceName}-cloudfront`,
                domainNames: [endpoint],
                certificate: aws_certificatemanager.Certificate.fromCertificateArn(this, 'cloudFrontCertificate', props.certificateArn),
                webAclId: waf.attrArn,
                enableLogging: true,
                logBucket: logBucket,
                logFilePrefix: 'cloudfront-logs/',
            });

            // 既存のビヘイビア
            distribution.addBehavior('decidim-packs/*', albOrigin, {
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: CachePolicy.CACHING_OPTIMIZED
            });

            // S3画像アクセス用のビヘイビア
            distribution.addBehavior('/s3/*', s3Origin, {
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
                cachePolicy: CachePolicy.CACHING_OPTIMIZED,
                originRequestPolicy: OriginRequestPolicy.CORS_S3_ORIGIN,
                functionAssociations: [{
                    function: stripS3PrefixFn,
                    eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
                }],
            });
        }

        // CloudFrontディストリビューションのドメイン名を出力
        new CfnOutput(this, 'CloudFrontDomainName', {
            value: distribution.distributionDomainName,
            description: 'CloudFront Distribution Domain Name',
            exportName: `${props.stage}-${props.serviceName}-CloudFrontDomainName`
        });

        this.cloudfrontEndpoint = distribution.distributionDomainName;

        // OAC IDを出力（S3バケットポリシー設定用）
        new CfnOutput(this, 'OriginAccessControlId', {
            value: originAccessControl.originAccessControlId,
            description: 'CloudFront Origin Access Control ID',
            exportName: `${props.stage}-${props.serviceName}-OAC-ID`
        });


        const ssmRegion = "ap-northeast-1";
        const prj = `/decidim-cfj/${props.stage}`;

        const putParam = (idSuffix: string, name: string, value: string) =>
            new AwsCustomResource(this, `Write${idSuffix}ToSsmApne1`, {
                onCreate: {
                    service: "SSM",
                    action: "putParameter",
                    region: ssmRegion,
                    parameters: {Name: name, Value: value, Type: "String", Overwrite: true},
                    physicalResourceId: PhysicalResourceId.of(`${name}-${distribution.distributionId}`),
                },
                onUpdate: {
                    service: "SSM",
                    action: "putParameter",
                    region: ssmRegion,
                    parameters: {Name: name, Value: value, Type: "String", Overwrite: true},
                    physicalResourceId: PhysicalResourceId.of(`${name}-${distribution.distributionId}`),
                },
                policy: AwsCustomResourcePolicy.fromSdkCalls({resources: AwsCustomResourcePolicy.ANY_RESOURCE}),
            });

        putParam("CfEndpoint", `${prj}/AWS_CLOUD_FRONT_END_POINT`, `${distribution.distributionDomainName}/s3`);
        putParam("CfId", `${prj}/CLOUDFRONT_DISTRIBUTION_ID`, distribution.distributionId);
        putParam("CfArn", `${prj}/CLOUDFRONT_DISTRIBUTION_ARN`,
            `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`
        );
    }
}
