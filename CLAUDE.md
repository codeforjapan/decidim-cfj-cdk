# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

このプロジェクトは、参加型民主主義プラットフォーム「Decidim」をAWS上にデプロイするためのAWS CDKインフラストラクチャコードです。TypeScriptとAWS CDK v2を使用して、ECS Fargate、RDS PostgreSQL、ElastiCache Redis、S3、CloudFront、Application Load Balancerなどのリソースをプロビジョニング・管理します。

## よく使用するコマンド

### ビルドと開発

```bash
npm run build              # TypeScriptをJavaScriptにコンパイル
npm run watch             # 変更を監視して自動コンパイル
npm run test              # Jestユニットテストを実行
```

### コード品質

```bash
npm run lint              # ESLintでコードをチェック
npm run lint:fix          # ESLintの問題を自動修正
npm run format            # Prettierでコードをフォーマット
npm run format:check      # フォーマットをチェック（変更なし）
npm run check             # format:checkとlintの両方を実行
```

### CDK操作

すべてのCDKコマンドには`--context stage=<stage>`が必要です。stageは`dev`、`staging`、`prd-v0292`、`dev2`のいずれかです。

```bash
# デプロイ前の差分を確認
npx cdk --context stage=dev --context tag=<image-tag> --profile decidim diff

# 全スタックをデプロイ
npx cdk --context stage=dev --context tag=<image-tag> --profile decidim deploy --all

# 特定のスタックをデプロイ
npx cdk --context stage=dev --context tag=<image-tag> --profile decidim deploy <stack-name>

# CloudFormationテンプレートを生成
npx cdk --context stage=dev --profile decidim synth

# CDKのブートストラップ（リージョンごとに1回のみ必要）
npx cdk --context stage=dev --context tag=<image-tag> --profile decidim bootstrap
```

### ECSタスクへのアクセス

```bash
# appコンテナに接続
aws ecs execute-command --region ap-northeast-1 \
  --cluster <stage>DecidimCluster \
  --task <task-id> \
  --container appContainer \
  --interactive \
  --command "/bin/bash" \
  --profile decidim

# コンテナ内でマイグレーションを実行
./bin/rails db:migrate

# コンテナ内でシードを実行（本番環境ではSEED=trueが必要）
SEED=true ./bin/rails db:seed
```

## アーキテクチャ概要

### スタック構成

インフラストラクチャは依存関係を持つ6つのCDKスタックで構成されています：

1. **S3Stack** (`lib/s3-stack.ts`)
   - ファイルストレージ用のS3バケットを作成
   - バケット名パターン: `${config.s3Bucket}-bucket`

2. **NetworkStack** (`lib/network.ts`)
   - VPCの作成または既存VPCのインポート
   - ALB、ECSサービス、RDS、ElastiCache用のセキュリティグループを定義
   - ElastiCacheサブネットグループを作成
   - SES用のVPCエンドポイントを設定

3. **RdsStack** (`lib/rds-stack.ts`)
   - PostgreSQL RDSインスタンスを作成
   - スナップショットからの復元が可能（ステージごとに設定）
   - NetworkStackに依存

4. **ElasticacheStack** (`lib/elasticache-stack.ts`)
   - キャッシュとSidekiqジョブキュー用のRedisクラスタを作成
   - NetworkStackに依存

5. **DecidimStack** (`lib/decidim-stack.ts`)
   - ECS Fargateサービスを含むメインアプリケーションスタック
   - 2つのサービス: メインDecidimアプリ（nginx + Rails）とSidekiqワーカー
   - HTTP/HTTPSリスナーを持つALBを作成
   - ALBを指すRoute53 Aレコードを設定
   - メンテナンスタスク用のEventBridgeスケジュールルールを設定
   - NetworkStackに依存

6. **CloudFrontStack** (`lib/cloudfront.ts`)
   - us-east-1リージョンのCDNディストリビューション
   - DecidimStackとS3Stackに依存

### 主要コンポーネント

#### DecidimStack ECSアーキテクチャ

メインアプリケーションはマルチコンテナタスク定義を使用：

- **nginxContainer**: リバースプロキシ（ポート80）、`lib/nginx`ディレクトリからビルド
- **appContainer**: Decidim Railsアプリケーション（ポート3000）
  - コマンド: `bundle exec rails db:create; rails s -b 0.0.0.0`
  - configで指定されたECRリポジトリを使用
  - イメージバージョンに`tag`コンテキストパラメータが必要

バックグラウンドジョブ処理用の独立したSidekiqサービス：

- **sidekiqContainer**: バックグラウンドジョブワーカー
  - コマンド: `bundle exec sidekiq -C /app/config/sidekiq.yml`

#### スケジュール実行タスク

EventBridgeルールがメインタスク定義を使用してrakeタスクをスケジュール実行：

- データクリーンアップ（毎日0:00 UTC）
- メトリクス計算（毎日0:10 UTC）
- オープンデータエクスポート（毎日0:20 UTC）
- 登録フォームクリーンアップ（毎日0:30 UTC）
- リマインダー生成（毎日0:40 UTC）
- 日次ダイジェストメール（毎日18:00 UTC）
- 週次ダイジェストメール（毎週土曜19:00 UTC）
- アクティブステップ更新（15分ごと）

#### 設定システム

`config/*.json`ファイル内のステージ固有の設定を`lib/config.ts`が読み込み：

- AWSアカウントとリージョン
- VPC設定（既存VPCのインポートまたは新規作成）
- RDS設定（インスタンスタイプ、スナップショット設定、ストレージ）
- ElastiCache設定（ノードタイプ、エンジンバージョン）
- ECS設定（ECRリポジトリ、証明書、キャパシティプロバイダー）
- ドメインとCloudFront証明書ARN

`getConfig()`関数が`stage`コンテキストパラメータに基づいて適切な設定ファイルを動的に読み込みます。

#### 環境変数

アプリケーション環境変数のソース：

1. `DecidimContainerEnvironment`内のハードコード値（lib/decidim-stack.ts:117-163）
2. AWS Systems Manager Parameter Store（パス: `/decidim-cfj/${stage}/*`）

必要なSSMパラメータ：

- `/decidim-cfj/${stage}/RDS_DB_NAME`
- `/decidim-cfj/${stage}/RDS_USERNAME`
- `/decidim-cfj/${stage}/RDS_PASSWORD`
- `/decidim-cfj/${stage}/SECRET_KEY_BASE`
- `/decidim-cfj/${stage}/SMTP_ADDRESS`
- `/decidim-cfj/${stage}/SMTP_USERNAME`
- `/decidim-cfj/${stage}/SMTP_PASSWORD`
- `/decidim-cfj/${stage}/SLACK_API_TOKEN`
- `/decidim-cfj/${stage}/NEW_RELIC_LICENSE_KEY`（prd-v0292のみ）

#### キャパシティプロバイダー

ECSサービスはステージごとに設定されたFargate/Fargate Spotの混合戦略を使用：

- メインアプリとSidekiqサービスの両方が同じキャパシティプロバイダー設定を使用
- 例: `fargateSpotCapacityProvider.weight: 1`、`fargateCapacityProvider.base: 1, weight: 2`

#### オートスケーリング

メインECSサービスは1〜5タスクの間でオートスケール：

- CPU目標: 50%
- メモリ目標: 70%

## 重要な注意事項

### ステージ設定

- すべてのCDKコマンドには`--context stage=<stage>`パラメータが必要
- 有効なステージ: `dev`、`staging`、`prd-v0292`、`dev2`
- `tag`コンテキストパラメータはデプロイ時に必要で、ECRのDecidim Dockerイメージタグを指定

### リソース命名規則

リソースは以下のパターンに従います: `${stage}${serviceName}<ResourceType>`

- サービス名は常に「decidim」
- 例: `devdecidimStack`、`stagingDecidimCluster`

### セキュリティグループ

NetworkStackは分離されたセキュリティグループを作成：

- ALBはどこからでもポート80、443の受信を許可
- ECSサービスはALBからのみポート80の受信を許可
- RDSはECSサービスからのみポート5432の受信を許可
- ElastiCacheはECSサービスからのみポート6379の受信を許可
- SES VPCエンドポイントは専用のセキュリティグループを使用

### VPC設定

プロジェクトは2つのモードをサポート：

1. **既存VPCのインポート**: configに`vpc`が定義されている場合、VPC IDでインポート
2. **新規VPC作成**: CIDR 10.0.0.0/16、NATゲートウェイなし、パブリック/プライベートサブネットでVPCを作成

両方のECSサービスはパブリックIPを割り当ててパブリックサブネットで実行されます。

### Redis URL

4つの異なるRedis URL環境変数がすべて同じElastiCacheインスタンスを指します：

- `REDIS_URL`
- `REDIS_CACHE_URL`
- `DECIDIM_SPAM_DETECTION_BACKEND_USER_REDIS_URL`（v0.30で追加）
- `DECIDIM_SPAM_DETECTION_BACKEND_RESOURCE_REDIS_URL`（v0.30で追加）

### デプロイ前の要件

デプロイ前に以下を確認：

1. AWSクレデンシャルがプロファイル名で設定されている（通常は`decidim`）
2. DecidimのDockerイメージを持つECRリポジトリが存在
3. ドメインのRoute53ホストゾーンが存在
4. ACM証明書がプロビジョニング済み（ALB用にap-northeast-1、CloudFront用にus-east-1）
5. シークレット用のSSMパラメータが作成済み
6. DockerイメージがタグとともにECRにプッシュ済み

### TypeScript設定

- ターゲット: ES2018
- Strictモード有効
- Node.js >= 22.0.0が必要
- デバッグ用にソースマップをインライン化

### テスト

Jestテストは`test/`ディレクトリにあり、スナップショットテストをサポート。テストは生成されたCloudFormationテンプレートを検証します。
