import { aws_elasticache as elasticache, Stack } from "aws-cdk-lib";

import { Construct } from "constructs";
import { BaseStackProps } from "./props";
import { CfnReplicationGroup, CfnReplicationGroupProps } from "aws-cdk-lib/aws-elasticache";

export interface ElastiCacheStackProps extends BaseStackProps {
  cacheNodeType: string
  engineVersion: string
  numCacheNodes: number
  automaticFailoverEnabled: boolean
  securityGroup: string
  ecSubnetGroup: elasticache.CfnSubnetGroup
}

export class ElasticacheStack extends Stack {
  public readonly redis: CfnReplicationGroup;

  constructor(scope: Construct, id: string, props: ElastiCacheStackProps) {
    super(scope, id, props);

    const elastiCacheProps: CfnReplicationGroupProps = {
      replicationGroupDescription: `${ props.stage }-${ props.serviceName }-cache`,
      engine: 'redis',
      replicationGroupId: `${ props.stage }-${ props.serviceName }-cache`,
      engineVersion: props.engineVersion,
      cacheNodeType: props.cacheNodeType,
      numCacheClusters: props.numCacheNodes,
      automaticFailoverEnabled: props.automaticFailoverEnabled,
      securityGroupIds: [props.securityGroup],
      cacheSubnetGroupName: props.ecSubnetGroup.cacheSubnetGroupName,
    }

    if (props.stage === 'prd-v0283') {
      this.redis = new elasticache.CfnReplicationGroup(this, 'prdElasticache', {
        ...elastiCacheProps,
        ...{
          multiAzEnabled: true,
        }
      })
    } else {
      this.redis = new elasticache.CfnReplicationGroup(this, 'elasticache', elastiCacheProps)
    }
  }
}
