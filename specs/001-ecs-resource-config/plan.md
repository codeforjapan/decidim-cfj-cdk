# 実装計画: 環境別ECSリソース設定

**ブランチ**: `001-ecs-resource-config` | **日付**: 2026-01-18 | **仕様**: [spec.md](./spec.md)
**入力**: `/specs/001-ecs-resource-config/spec.md`から得た機能仕様

## 概要

現在、すべての環境（dev、staging、prd-v0292、dev2）で統一されているECSタスクのCPUとメモリ設定を、環境ごとに異なるスペックを設定可能にする。設定は既存のJSON設定ファイル（`config/*.json`）に追加し、後方互換性を維持しながらインフラ運用者がコスト最適化とリソース調整を柔軟に行えるようにする。

**技術的アプローチ**:

1. 設定インターフェース（`lib/config.ts`）にECSリソース設定の型定義を追加
2. 各環境の設定ファイルにオプショナルな`mainApp`、`sidekiq`、`scheduledTasks`リソース設定を追加可能にする
3. `DecidimStack`（`lib/decidim-stack.ts`）のタスク定義作成ロジックを修正し、設定値を使用する
4. 設定値が存在しない場合は現在のデフォルト値を使用することで後方互換性を保証

## 技術コンテキスト

**言語/バージョン**: TypeScript 4.9.5, Node.js >= 22.0.0
**主要依存関係**: AWS CDK 2.225.0, aws-cdk-lib 2.225.0, constructs 10.4.3
**ストレージ**: 該当なし（設定管理のみ、JSONファイルベース）
**テスト**: Jest 29.7.0, ts-jest 29.4.5でスナップショットテスト
**ターゲットプラットフォーム**: AWS（ECS Fargate、CloudFormation）
**プロジェクトタイプ**: インフラストラクチャ（AWS CDK）
**パフォーマンス目標**: CDK合成時間への影響なし（設定読み込みのみ）
**制約事項**:

- AWS Fargateの有効なCPU/メモリ組み合わせに従う必要がある
- 後方互換性を維持（既存デプロイに影響なし）
- 既存の設定ファイル構造パターンに従う
  **スケール/スコープ**:
- 4つの環境設定ファイル（dev.json、staging.json、prd-v0292.json、dev2.json）
- 3つのタスクタイプ（メインアプリ、Sidekiq、スケジュールタスク）
- 2つのTypeScriptファイルの変更（config.ts、decidim-stack.ts）

## 憲法チェック

_GATE: フェーズ0のリサーチ前に合格する必要がある。フェーズ1の設計後に再チェック。_

### I. Infrastructure-as-Code標準

✅ **合格**: すべての変更はAWS CDK with TypeScriptを通じて実装される。設定はJSON形式で宣言的に定義され、CDKスタックによってプロビジョニングされる。手動のコンソール変更は不要。

### II. マルチステージアーキテクチャ

✅ **合格**: この機能は、各ステージが独立したリソース設定を持つことを可能にし、マルチステージアーキテクチャの原則を強化する。各ステージは他のステージに影響を与えることなく独立してデプロイ可能。

### III. セキュリティとアクセス制御

✅ **合格**: セキュリティ関連の変更なし。リソース設定（CPU/メモリ）のみを扱い、セキュリティグループ、シークレット、暗号化には影響しない。

### IV. 設定管理

✅ **合格**: この機能は設定管理の原則を完全に遵守し、さらに強化する：

- すべての新しい設定は`config/`配下のJSONファイルに外部化される
- `lib/config.ts`を通じて型安全な設定読み込みを実装
- ハードコードされた値（現在のCPU/メモリ）を設定可能な値に変換

### V. テストと検証

✅ **合格**:

- 既存のJestスナップショットテストを更新して新しい設定構造を反映
- デプロイ前に`cdk diff`でCloudFormationテンプレートの変更を検証
- ESLintとPrettierによるコード品質チェックは引き続き適用

### VI. ドキュメント言語統一

✅ **合格**: すべてのドキュメント（この計画書、仕様書、タスクリスト）は日本語で記述されている。コード内のコメントも日本語で記述する。

**総合評価**: ✅ すべてのゲートを合格。フェーズ0のリサーチに進むことができる。

## プロジェクト構造

### ドキュメント（この機能）

```text
specs/001-ecs-resource-config/
├── spec.md              # 機能仕様書（完成）
├── plan.md              # この実装計画（/speckit.planコマンド出力）
├── research.md          # フェーズ0出力（/speckit.planコマンド）
├── data-model.md        # フェーズ1出力（/speckit.planコマンド）
├── quickstart.md        # フェーズ1出力（/speckit.planコマンド）
├── contracts/           # フェーズ1出力（/speckit.planコマンド）
├── checklists/
│   └── requirements.md  # 仕様品質チェックリスト（完成）
└── tasks.md             # フェーズ2出力（/speckit.tasksコマンド - /speckit.planでは作成しない）
```

### ソースコード（リポジトリルート）

```text
# インフラストラクチャプロジェクト（AWS CDK）
lib/
├── config.ts                    # [変更] 設定型定義とローダー
├── decidim-stack.ts             # [変更] ECSタスク定義作成ロジック
├── network.ts                   # [変更なし]
├── rds-stack.ts                 # [変更なし]
├── elasticache-stack.ts         # [変更なし]
├── s3-stack.ts                  # [変更なし]
├── cloudfront.ts                # [変更なし]
├── props.ts                     # [変更なし]
└── nginx/                       # [変更なし]

config/
├── dev.json                     # [変更] ECSリソース設定を追加
├── staging.json                 # [変更] ECSリソース設定を追加
├── prd-v0292.json               # [変更] ECSリソース設定を追加
└── dev2.json                    # [変更] ECSリソース設定を追加

test/
└── decidim-cfj-cdk.test.ts      # [更新] スナップショットテストを更新

bin/
└── decidim-cfj-cdk.ts           # [変更なし] エントリーポイント
```

**構造決定**: 既存のインフラストラクチャプロジェクト構造を維持。設定管理システム（`lib/config.ts`と`config/*.json`）とECSスタック定義（`lib/decidim-stack.ts`）のみを変更する。この変更は既存のアーキテクチャパターンに従い、新しいディレクトリやモジュールは不要。

## 複雑性追跡

> **憲法チェックに違反がある場合のみ記入**

該当なし。すべての憲法原則に準拠している。

## フェーズ0: アウトラインとリサーチ

### リサーチタスク

以下の技術的詳細について調査が必要：

1. **AWS Fargate CPU/メモリの有効な組み合わせ**
   - 調査目的: AWS Fargateで許可されているCPU/メモリの組み合わせルールを確認
   - 調査対象: AWS公式ドキュメント、CDKのFargateTaskDefinition API
   - 成果物: 有効な組み合わせ表とCDKでの検証方法

2. **TypeScript型定義のベストプラクティス**
   - 調査目的: オプショナルなネストされた設定のための型定義パターン
   - 調査対象: TypeScript Handbook、既存のconfig.tsパターン
   - 成果物: 後方互換性を持つ型定義のアプローチ

3. **CDKタスク定義の動的設定パターン**
   - 調査目的: 既存コードでのデフォルト値とオプショナル設定の処理方法を確認
   - 調査対象: decidim-stack.tsの現在の実装パターン、containerSpecの使用方法
   - 成果物: 一貫性のある設定適用パターン

4. **スケジュールタスクの独立したタスク定義**
   - 調査目的: スケジュールタスクが独立したリソース設定を持つための実装方法
   - 調査対象: 現在のEventBridgeルール実装、タスク定義の共有パターン
   - 成果物: スケジュールタスク用の独立したタスク定義戦略

### 成果物

`research.md`ファイルに以下を記載：

- 各リサーチタスクの決定事項
- 選択した理由
- 検討した代替案
- 実装への具体的な推奨事項

## フェーズ1: 設計とコントラクト

### 前提条件

`research.md`が完了していること

### データモデル

**エンティティ**: ECSタスクリソース設定

`data-model.md`に以下を記載：

- `EcsTaskResourceConfig`インターフェース定義
  - フィールド: `cpu?: number`, `memory?: number`
  - 検証ルール: オプショナル、指定する場合は両方または片方のみ
- `EcsConfig`インターフェースへの統合
  - フィールド追加: `mainApp?: EcsTaskResourceConfig`, `sidekiq?: EcsTaskResourceConfig`, `scheduledTasks?: EcsTaskResourceConfig`
- デフォルト値の定義
  - メインアプリ: CPU 2048, メモリ4096
  - Sidekiq: CPU 512, メモリ2048
  - スケジュールタスク: メインアプリと同じ値を継承

### API/コントラクト

**該当なし**: この機能はインフラストラクチャ設定の変更であり、外部APIやエンドポイントは含まない。

設定ファイルのJSONスキーマを`contracts/`に記載：

- `config-schema.json`: 新しいECS設定構造のJSONスキーマ
- 例示: dev.jsonとprd-v0292.jsonの設定例

### クイックスタート

`quickstart.md`に以下を記載：

1. 設定ファイルへのECSリソース設定追加方法
2. 有効なCPU/メモリ組み合わせの参照表
3. デプロイと検証手順
4. ロールバック手順

### エージェントコンテキスト更新

```bash
.specify/scripts/bash/update-agent-context.sh claude
```

### 成果物

- `data-model.md`: 型定義とインターフェース設計
- `contracts/config-schema.json`: 設定ファイルのJSONスキーマ
- `contracts/examples/`: 設定例ファイル
- `quickstart.md`: 実装と利用ガイド
- エージェント固有のコンテキストファイル（`.claude/`または該当ディレクトリ）

## フェーズ1後の憲法再チェック

設計完了後、すべての憲法原則への準拠を再確認：

- ✅ Infrastructure-as-Code標準: CDK TypeScriptによる宣言的定義
- ✅ マルチステージアーキテクチャ: ステージ独立の設定をサポート
- ✅ セキュリティとアクセス制御: セキュリティへの影響なし
- ✅ 設定管理: 外部化された型安全な設定
- ✅ テストと検証: スナップショットテストとCDK diff
- ✅ ドキュメント言語統一: すべて日本語で記述

## 次のステップ

この計画（plan.md）の完了後：

1. **フェーズ0**: `research.md`を生成してすべての技術的詳細を解決
2. **フェーズ1**: `data-model.md`、`contracts/`、`quickstart.md`を生成
3. **フェーズ2**: `/speckit.tasks`コマンドで`tasks.md`を生成（この計画コマンドでは作成しない）
4. **実装**: `/speckit.implement`コマンドでタスクを実行

**注意**: `/speckit.plan`コマンドはフェーズ1の計画までで停止します。タスク生成は別のコマンド（`/speckit.tasks`）で実行します。
