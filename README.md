# Decidim-cfj CDK

# Documentation

- 開発環境
    - [ビルド方法](docs/build_dev.md)

# CDK

```console
$ npx cdk --context stage=dev --profile decidim diff
```


## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
