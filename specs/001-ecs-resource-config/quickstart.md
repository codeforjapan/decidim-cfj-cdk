# クイックスタート: 環境別ECSリソース設定

**日付**: 2026-01-18
**フェーズ**: フェーズ1 - 設計とコントラクト
**関連**: [plan.md](./plan.md), [spec.md](./spec.md), [data-model.md](./data-model.md)

## 概要

このガイドでは、環境ごとに異なるECSタスクのCPUとメモリリソースを設定する方法を説明します。

## 前提条件

- AWS CDK 2.225.0以降がインストールされている
- TypeScript 4.9.5以降がインストールされている
- プロジェクトがビルド済み（`npm run build`）
- 設定したい環境の設定ファイル（`config/<stage>.json`）へのアクセス権

## 設定方法

### ステップ1: 設定ファイルの確認

環境の設定ファイルを開きます（例: `config/dev.json`）。

### ステップ2: ECSリソース設定の追加

`ecs`セクションに以下のフィールドを追加します：

```json
{
  "ecs": {
    "smtpDomain": "diycities.jp",
    "repository": "decidim-cfj",
    "certificates": ["..."],
    "fargateSpotCapacityProvider": { "weight": 1 },
    "fargateCapacityProvider": { "base": 1, "weight": 2 },

    // ========== 新規フィールドを追加 ==========
    "mainApp": {
      "cpu": 1024, // CPU単位（1024 = 1 vCPU）
      "memory": 2048 // メモリ（MiB）
    },
    "sidekiq": {
      "cpu": 512,
      "memory": 1024
    }
    // scheduledTasksは現在使用されないため、追加不要
  }
}
```

### ステップ3: 有効なCPU/メモリ組み合わせの確認

AWS Fargateでは、CPUとメモリの組み合わせに制限があります。以下の表を参照してください：

| CPU (CPU units) | vCPU | メモリ (MiB) の範囲                                                                 |
| --------------- | ---- | ----------------------------------------------------------------------------------- |
| 256             | 0.25 | 512, 1024, 2048                                                                     |
| 512             | 0.5  | 1024, 2048, 3072, 4096                                                              |
| 1024            | 1    | 2048, 3072, 4096, 5120, 6144, 7168, 8192                                            |
| 2048            | 2    | 4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384 |
| 4096            | 4    | 8192 - 30720 (1024単位で増加)                                                       |
| 8192            | 8    | 16384 - 61440 (4096単位で増加)                                                      |
| 16384           | 16   | 32768 - 122880 (8192単位で増加)                                                     |

**例**:

- ✅ 有効: CPU 1024, メモリ2048
- ✅ 有効: CPU 2048, メモリ4096
- ✅ 有効: CPU 4096, メモリ16384
- ❌ 無効: CPU 512, メモリ8192（範囲外）
- ❌ 無効: CPU 1024, メモリ1024（範囲外）

### ステップ4: デプロイ前の検証

設定変更を検証します：

```bash
# TypeScriptコードをコンパイル
npm run build

# CloudFormationテンプレートの差分を確認
npx cdk --context stage=dev --context tag=<image-tag> --profile decidim diff

# コード品質チェック
npm run check
```

**差分の確認ポイント**:

- `FargateTaskDefinition`のCPUとメモリが期待値になっているか
- 既存のリソースに意図しない変更がないか

### ステップ5: デプロイ

```bash
# 全スタックをデプロイ
npx cdk --context stage=dev --context tag=<image-tag> --profile decidim deploy --all

# または特定のスタックのみデプロイ
npx cdk --context stage=dev --context tag=<image-tag> --profile decidim deploy devdecidimStack
```

### ステップ6: デプロイ後の確認

ECSタスク定義が正しく更新されたことを確認します：

**AWS CLIで確認**:

```bash
# タスク定義の詳細を取得
aws ecs describe-task-definition \
  --task-definition devDecidimTaskDefinition \
  --region ap-northeast-1 \
  --profile decidim \
  --query 'taskDefinition.{cpu:cpu,memory:memory}' \
  --output table

# Sidekiqタスク定義の確認
aws ecs describe-task-definition \
  --task-definition devSidekiqTaskDefinition \
  --region ap-northeast-1 \
  --profile decidim \
  --query 'taskDefinition.{cpu:cpu,memory:memory}' \
  --output table
```

**AWS コンソールで確認**:

1. ECS → クラスター → `<stage>DecidimCluster`
2. タスク定義 → `<stage>DecidimTaskDefinition`（最新リビジョン）
3. CPU/メモリの値を確認

## 設定例

### 開発環境（コスト最適化）

```json
{
  "ecs": {
    "mainApp": {
      "cpu": 1024,
      "memory": 2048
    },
    "sidekiq": {
      "cpu": 512,
      "memory": 1024
    }
  }
}
```

**コスト削減**: 本番環境の50%のリソースで実行

### ステージング環境（本番相当）

```json
{
  "ecs": {
    "mainApp": {
      "cpu": 2048,
      "memory": 4096
    },
    "sidekiq": {
      "cpu": 1024,
      "memory": 2048
    }
  }
}
```

**用途**: 本番環境と同じリソースでテスト

### 本番環境（高性能）

```json
{
  "ecs": {
    "mainApp": {
      "cpu": 4096,
      "memory": 8192
    },
    "sidekiq": {
      "cpu": 2048,
      "memory": 4096
    }
  }
}
```

**用途**: 高負荷に対応

### 後方互換性（設定なし）

```json
{
  "ecs": {
    "smtpDomain": "diycities.jp",
    "repository": "decidim-cfj",
    "certificates": ["..."],
    "fargateSpotCapacityProvider": { "weight": 1 },
    "fargateCapacityProvider": { "base": 1, "weight": 2 }
    // mainApp、sidekiqなし
  }
}
```

**動作**: デフォルト値を使用

- メインアプリ: CPU 2048, メモリ4096
- Sidekiq: CPU 512, メモリ2048

## よくある質問

### Q1: CPUのみ、またはメモリのみを変更できますか？

**A**: はい、可能です。

```json
{
  "ecs": {
    "mainApp": {
      "cpu": 4096
      // memoryは指定なし → デフォルト4096を使用
    }
  }
}
```

ただし、CPUとメモリの組み合わせがAWS Fargateの制限を満たす必要があります。

### Q2: スケジュールタスクのリソースを変更するには？

**A**: 現在、スケジュールタスクはメインアプリのタスク定義を使用します。スケジュールタスクのリソースを変更するには、`mainApp`の設定を変更してください。

`scheduledTasks`フィールドは将来の独立した設定のために予約されていますが、現在は使用されません。

### Q3: 無効なCPU/メモリ組み合わせを指定するとどうなりますか？

**A**: AWS CDKが`cdk synth`または`cdk diff`時にエラーを発生させます。

```
Error: The task memory for tasks with the Fargate launch type must be between 1024 and 30720 for cpu value 4096
```

このエラーが発生した場合は、有効な組み合わせ表を参照して設定を修正してください。

### Q4: 既存の環境に影響はありますか？

**A**: いいえ、既存の環境に影響はありません。

- 新しいフィールドを追加しない場合、既存の動作を維持（デフォルト値を使用）
- 新しいフィールドを追加した環境のみ、設定値を使用
- 各環境は独立して設定可能

### Q5: デプロイ後、すぐにリソース変更が反映されますか？

**A**: 既存のタスクはすぐには影響を受けません。

- **新しいタスク**: 新しいリソース設定で起動
- **既存のタスク**: 次回のデプロイまたは再起動時に新しい設定を使用
- **ローリングデプロイ**: ECSサービスは自動的に新しいタスク定義で置き換え

ECSサービスのローリング更新により、段階的に新しいリソース設定のタスクに置き換わります。

### Q6: オートスケーリングのターゲットは変更されますか？

**A**: いいえ、オートスケーリングのターゲットは変更されません。

現在の設定を維持：

- CPU目標: 50%
- メモリ目標: 70%
- 最小タスク数: 1
- 最大タスク数: 5

これらの値は環境間で一定です。

## トラブルシューティング

### エラー: 無効なCPU/メモリ組み合わせ

**症状**:

```
Error: The task memory for tasks with the Fargate launch type must be...
```

**解決方法**:

1. 有効な組み合わせ表を確認
2. 設定ファイルを修正
3. `npm run build && npx cdk diff`で再検証

### エラー: TypeScript型エラー

**症状**:

```
Property 'mainApp' does not exist on type 'EcsConfig'
```

**解決方法**:

1. `npm run build`でTypeScriptコードを再コンパイル
2. `lib/config.ts`が最新版であることを確認
3. キャッシュをクリア: `rm -rf node_modules/.cache`

### タスクが起動しない

**症状**: ECSタスクが`PENDING`状態のままで起動しない

**考えられる原因**:

- メモリ不足: 設定したメモリが小さすぎてアプリケーションが起動できない
- CPU不足: 設定したCPUが小さすぎて処理が遅延

**解決方法**:

1. CloudWatch Logsでタスクログを確認
2. リソース設定を増やして再デプロイ
3. 本番環境相当の設定でテストしてから本番環境にデプロイ

## ロールバック手順

設定変更によって問題が発生した場合のロールバック手順：

### 方法1: 設定ファイルを元に戻す

1. 設定ファイルを編集して元の値に戻す（または`mainApp`/`sidekiq`フィールドを削除）
2. 再デプロイ:
   ```bash
   npm run build
   npx cdk --context stage=<stage> --context tag=<image-tag> --profile decidim deploy --all
   ```

### 方法2: 以前のCloudFormationスタックにロールバック

```bash
# スタックの変更履歴を確認
aws cloudformation describe-stack-events \
  --stack-name <stage>decidimStack \
  --region ap-northeast-1 \
  --profile decidim

# 以前のバージョンにロールバック（AWS コンソール経由を推奨）
```

### 方法3: ECSタスク定義の以前のリビジョンを使用

```bash
# 以前のタスク定義リビジョンを確認
aws ecs list-task-definitions \
  --family-prefix <stage>DecidimTaskDefinition \
  --sort DESC \
  --region ap-northeast-1 \
  --profile decidim

# サービスを更新して以前のタスク定義を使用
aws ecs update-service \
  --cluster <stage>DecidimCluster \
  --service <stage>DecidimService \
  --task-definition <stage>DecidimTaskDefinition:<revision> \
  --region ap-northeast-1 \
  --profile decidim
```

## 次のステップ

1. **テスト環境で検証**: dev環境で設定を試してから本番環境に適用
2. **モニタリング**: CloudWatch メトリクスでCPU/メモリ使用率を監視
3. **最適化**: 実際の使用状況に基づいてリソース設定を調整

## 参考資料

- [AWS Fargate task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [AWS CDK ECS Documentation](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs-readme.html)
- [data-model.md](./data-model.md): 型定義とインターフェース詳細
- [research.md](./research.md): 技術的調査結果
- [spec.md](./spec.md): 機能仕様
