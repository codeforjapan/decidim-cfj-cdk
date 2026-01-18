# リサーチ: 環境別ECSリソース設定

**日付**: 2026-01-18
**フェーズ**: フェーズ0 - アウトラインとリサーチ
**関連**: [plan.md](./plan.md), [spec.md](./spec.md)

## 概要

このドキュメントは、環境別ECSリソース設定機能の実装に必要な技術的詳細の調査結果をまとめたものです。

## 1. AWS Fargate CPU/メモリの有効な組み合わせ

### 決定事項

AWS Fargateでは、CPUとメモリの組み合わせに制約があります。CDKの`FargateTaskDefinition`はこれらの制約を自動的に検証します。

### 有効な組み合わせ表

| CPU (CPU units) | メモリ (MiB) の範囲                                                                 |
| --------------- | ----------------------------------------------------------------------------------- |
| 256 (.25 vCPU)  | 512, 1024, 2048                                                                     |
| 512 (.5 vCPU)   | 1024, 2048, 3072, 4096                                                              |
| 1024 (1 vCPU)   | 2048, 3072, 4096, 5120, 6144, 7168, 8192                                            |
| 2048 (2 vCPU)   | 4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384 |
| 4096 (4 vCPU)   | 8192 - 30720 (1024単位)                                                             |
| 8192 (8 vCPU)   | 16384 - 61440 (4096単位)                                                            |
| 16384 (16 vCPU) | 32768 - 122880 (8192単位)                                                           |

### CDKでの検証方法

AWS CDKの`FargateTaskDefinition`コンストラクタは、無効な組み合わせが指定された場合、合成時（`cdk synth`）に自動的にエラーを発生させます。

```typescript
// 無効な組み合わせの例（CDKが合成時にエラーを発生）
new ecs.FargateTaskDefinition(this, 'TaskDef', {
  cpu: 512,
  memoryLimitMiB: 8192, // エラー: 512 CPUでは最大4096 MiBまで
});
```

**実装への推奨事項**:

- 設定ファイルでの検証ロジックは不要（CDKが自動検証）
- CLAUDE.mdまたはquickstart.mdに有効な組み合わせ表を記載
- デプロイ前の`cdk synth`または`cdk diff`で検証可能

### 根拠

- AWS公式ドキュメント: [AWS Fargate task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- CDKの型安全性により、実行時エラーを防止
- インフラ運用者は表を参照して適切な値を設定可能

### 検討した代替案

1. **設定ファイルでバリデーション**: JSON Schemaやカスタムバリデータで事前検証
   - 却下理由: CDKが既に提供しており、重複する。保守コストが増える
2. **厳密な型定義**: 有効な組み合わせのみ許可するTypeScript型
   - 却下理由: 型定義が複雑になりすぎる。CDKの検証で十分

## 2. TypeScript型定義のベストプラクティス

### 決定事項

オプショナルなネストされた設定には、既存の`config.ts`パターンに従い、インターフェースの階層構造を使用します。

### 型定義アプローチ

```typescript
// 新しいインターフェース
export interface EcsTaskResourceConfig {
  cpu?: number;
  memory?: number;
}

// 既存のEcsConfigインターフェースを拡張
export interface EcsConfig {
  // 既存フィールド
  smtpDomain: string;
  repository: string;
  certificates: string[];
  fargateCapacityProvider: capacityProviderStrategy;
  fargateSpotCapacityProvider: capacityProviderStrategy;

  // 新規フィールド（オプショナル）
  mainApp?: EcsTaskResourceConfig;
  sidekiq?: EcsTaskResourceConfig;
  scheduledTasks?: EcsTaskResourceConfig;
}
```

### 後方互換性の保証

オプショナル（`?`）にすることで、既存の設定ファイルに新しいフィールドがなくてもTypeScriptの型チェックを通過します。

```typescript
// 既存の設定ファイル（フィールドなし）- 引き続き有効
{
  "ecs": {
    "smtpDomain": "example.com",
    "repository": "decidim-cfj",
    // mainApp, sidekiq, scheduledTasksなし - 問題なし
  }
}

// 新しい設定ファイル（フィールドあり）- 有効
{
  "ecs": {
    "smtpDomain": "example.com",
    "repository": "decidim-cfj",
    "mainApp": {
      "cpu": 4096,
      "memory": 8192
    }
  }
}
```

### 実装への推奨事項

1. `lib/config.ts`に`EcsTaskResourceConfig`インターフェースを追加
2. `EcsConfig`インターフェースに3つのオプショナルフィールドを追加
3. `decidim-stack.ts`でデフォルト値を定義する定数を作成
4. Null合体演算子（`??`）でデフォルト値を適用

```typescript
// デフォルト値の定義例
const DEFAULT_MAIN_APP_CPU = 2048;
const DEFAULT_MAIN_APP_MEMORY = 4096;
const DEFAULT_SIDEKIQ_CPU = 512;
const DEFAULT_SIDEKIQ_MEMORY = 2048;

// 使用例
const mainAppCpu = props.config.ecs.mainApp?.cpu ?? DEFAULT_MAIN_APP_CPU;
const mainAppMemory = props.config.ecs.mainApp?.memory ?? DEFAULT_MAIN_APP_MEMORY;
```

### 根拠

- 既存の`config.ts`パターンと一貫性がある
- TypeScriptの型安全性を活用
- オプショナルチェイニング（`?.`）とNull合体演算子（`??`）で簡潔に記述可能
- JSONファイルとの親和性が高い

### 検討した代替案

1. **Partial<T>型を使用**: すべてのフィールドをオプショナルにする
   - 却下理由: 必須フィールドとオプショナルフィールドの区別が曖昧になる
2. **ユニオン型**: 設定ありと設定なしのバリアント
   - 却下理由: 型定義が複雑になり、既存パターンから逸脱

## 3. CDKタスク定義の動的設定パターン

### 決定事項

既存の`decidim-stack.ts`では、`containerSpec`プロパティ（オプショナル）を使用して動的にCPU/メモリを設定するパターンがすでに実装されています。このパターンを拡張します。

### 現在の実装パターン

```typescript
// lib/decidim-stack.ts:85-91（現在のコード）
const taskDefinition = new ecs.FargateTaskDefinition(this, 'decidimTaskDefinition', {
  cpu: props.containerSpec ? props.containerSpec.cpu : 2048,
  memoryLimitMiB: props.containerSpec ? props.containerSpec?.memoryLimitMiB : 4096,
  family: `${props.stage}DecidimTaskDefinition`,
  taskRole: backendTaskRole,
  executionRole: backendTaskRole,
});
```

### 新しい実装パターン

既存の`containerSpec`を削除し、設定ファイルから直接読み込むパターンに統一します。

```typescript
// 新しいアプローチ
const DEFAULT_MAIN_APP_CPU = 2048;
const DEFAULT_MAIN_APP_MEMORY = 4096;
const DEFAULT_SIDEKIQ_CPU = 512;
const DEFAULT_SIDEKIQ_MEMORY = 2048;

// メインアプリケーションタスク定義
const taskDefinition = new ecs.FargateTaskDefinition(this, 'decidimTaskDefinition', {
  cpu: props.config.ecs.mainApp?.cpu ?? DEFAULT_MAIN_APP_CPU,
  memoryLimitMiB: props.config.ecs.mainApp?.memory ?? DEFAULT_MAIN_APP_MEMORY,
  family: `${props.stage}DecidimTaskDefinition`,
  taskRole: backendTaskRole,
  executionRole: backendTaskRole,
});

// Sidekiqタスク定義
const sidekiqTaskDefinition = new ecs.FargateTaskDefinition(this, 'sidekiqTaskDefinition', {
  cpu: props.config.ecs.sidekiq?.cpu ?? DEFAULT_SIDEKIQ_CPU,
  memoryLimitMiB: props.config.ecs.sidekiq?.memory ?? DEFAULT_SIDEKIQ_MEMORY,
  family: `${props.stage}SidekiqTaskDefinition`,
  taskRole: backendTaskRole,
  executionRole: backendTaskRole,
});
```

### 実装への推奨事項

1. `DecidimStackProps`インターフェースから`containerSpec`プロパティを削除
2. 代わりに`config: Config`プロパティを追加（既存の設定オブジェクト全体を渡す）
3. タスク定義作成時にオプショナルチェイニングとNull合体演算子でデフォルト値を適用
4. デフォルト値を定数として定義し、コメントで現在の値であることを明記

### 根拠

- 既存の`containerSpec`パターンと整合性がある
- オプショナルチェイニング（`?.`）とNull合体演算子（`??`）は簡潔で読みやすい
- 設定ファイルから直接読み込むことで、設定管理が一元化される
- デフォルト値は既存のハードコード値を使用し、後方互換性を保証

### 検討した代替案

1. **ヘルパー関数**: `getResourceConfig(config, type, defaultValues)`のような関数
   - 却下理由: 2行のコードで済むため、関数の方がオーバーヘッド
2. **ビルダーパターン**: タスク定義をビルダーで構築
   - 却下理由: CDKのコンストラクタパターンと整合性がない

## 4. スケジュールタスクの独立したタスク定義

### 決定事項

スケジュールタスクは現在メインアプリのタスク定義を共有しています。独立したリソース設定を提供するために、**2つのアプローチを検討し、アプローチ2（メインタスク定義を使用、設定のみ提供）を採用します**。

### 現在の実装

```typescript
// lib/decidim-stack.ts:461-482（現在のコード）
eventTasks.map((task) => {
  new Rule(this, task.id, {
    schedule: Schedule.expression(task.scheduleExpression),
    targets: [
      new EcsTask({
        cluster: cluster,
        taskDefinition: taskDefinition, // メインアプリのタスク定義を使用
        assignPublicIp: true,
        securityGroups: [props.securityGroup],
        subnetSelection: {
          subnetType: aws_ec2.SubnetType.PUBLIC,
        },
        containerOverrides: [
          {
            containerName: 'appContainer',
            command: task.command, // コマンドのみオーバーライド
          },
        ],
      }),
    ],
  });
});
```

### 検討したアプローチ

#### アプローチ1: 独立したタスク定義を作成（却下）

スケジュールタスク専用の新しいタスク定義を作成する。

```typescript
// 新しいタスク定義を作成
const scheduledTaskDefinition = new ecs.FargateTaskDefinition(this, 'scheduledTaskDefinition', {
  cpu:
    props.config.ecs.scheduledTasks?.cpu ?? props.config.ecs.mainApp?.cpu ?? DEFAULT_MAIN_APP_CPU,
  memoryLimitMiB:
    props.config.ecs.scheduledTasks?.memory ??
    props.config.ecs.mainApp?.memory ??
    DEFAULT_MAIN_APP_MEMORY,
  family: `${props.stage}ScheduledTaskDefinition`,
  taskRole: backendTaskRole,
  executionRole: backendTaskRole,
});

// 同じコンテナ設定を追加（メインアプリと同じ）
scheduledTaskDefinition.addContainer('appContainer', {
  /* ... */
});

// EventBridgeルールで使用
new EcsTask({
  taskDefinition: scheduledTaskDefinition,
  // ...
});
```

**却下理由**:

- コンテナ定義の重複が発生（メインアプリと同じコンテナ設定）
- タスク定義の数が増え、管理が複雑になる
- スケジュールタスクは頻繁に実行されないため、独立したタスク定義のメリットが少ない
- 設定の同期が必要（メインアプリの設定変更時にスケジュールタスクも更新）

#### アプローチ2: メインタスク定義を使用、設定のみ提供（採用）

メインアプリのタスク定義を引き続き使用し、`scheduledTasks`設定はドキュメント目的のみとする。将来的に独立が必要になった場合の準備として設定インターフェースを提供。

```typescript
// 現在の実装を維持
eventTasks.map((task) => {
  new Rule(this, task.id, {
    schedule: Schedule.expression(task.scheduleExpression),
    targets: [
      new EcsTask({
        cluster: cluster,
        taskDefinition: taskDefinition, // メインアプリのタスク定義を使用
        // ...
      }),
    ],
  });
});
```

**採用理由**:

- シンプルで保守しやすい
- 既存の実装を大きく変更する必要がない
- スケジュールタスクはメインアプリと同じコンテナイメージ・設定を使用するため、同じタスク定義で問題ない
- 将来的に独立が必要になった場合、設定インターフェースは既に存在する

### 実装への推奨事項

1. `EcsConfig`インターフェースに`scheduledTasks?: EcsTaskResourceConfig`を追加（将来の拡張用）
2. 現在の実装は変更せず、メインアプリのタスク定義を使用し続ける
3. `quickstart.md`に以下を明記:
   - 「スケジュールタスクは現在メインアプリのタスク定義を使用」
   - 「`scheduledTasks`設定は将来の独立した設定のために予約されている」
   - 「スケジュールタスクのリソースを調整するには、`mainApp`設定を変更」

### 根拠

- **Simplicity over Premature Optimization**: 現時点で独立したタスク定義が不要なら、シンプルな実装を維持
- **YAGNI (You Aren't Gonna Need It)**: 将来の要件が明確になるまで複雑な実装を避ける
- **後方互換性**: 既存の動作を変更せず、設定インターフェースのみ提供
- **憲法原則との整合性**: 複雑性を避け、必要最小限の変更にとどめる

### 将来の拡張パス

独立したタスク定義が必要になった場合（例: スケジュールタスクのメモリ要件が大幅に異なる）:

1. `scheduledTaskDefinition`を新規作成
2. `scheduledTasks`設定を適用
3. `EcsTask`のtargetで新しいタスク定義を使用
4. ドキュメントを更新

## 実装への統合推奨事項

上記のリサーチ結果を基に、以下の実装を推奨：

### 1. 型定義（lib/config.ts）

```typescript
export interface EcsTaskResourceConfig {
  cpu?: number;
  memory?: number;
}

export interface EcsConfig {
  smtpDomain: string;
  repository: string;
  certificates: string[];
  fargateCapacityProvider: capacityProviderStrategy;
  fargateSpotCapacityProvider: capacityProviderStrategy;
  // 新規フィールド
  mainApp?: EcsTaskResourceConfig;
  sidekiq?: EcsTaskResourceConfig;
  scheduledTasks?: EcsTaskResourceConfig; // 将来の拡張用
}
```

### 2. タスク定義作成（lib/decidim-stack.ts）

```typescript
// デフォルト値定義
const DEFAULT_MAIN_APP_CPU = 2048;
const DEFAULT_MAIN_APP_MEMORY = 4096;
const DEFAULT_SIDEKIQ_CPU = 512;
const DEFAULT_SIDEKIQ_MEMORY = 2048;

// メインアプリ
const taskDefinition = new ecs.FargateTaskDefinition(this, 'decidimTaskDefinition', {
  cpu: props.config.ecs.mainApp?.cpu ?? DEFAULT_MAIN_APP_CPU,
  memoryLimitMiB: props.config.ecs.mainApp?.memory ?? DEFAULT_MAIN_APP_MEMORY,
  // ...
});

// Sidekiq
const sidekiqTaskDefinition = new ecs.FargateTaskDefinition(this, 'sidekiqTaskDefinition', {
  cpu: props.config.ecs.sidekiq?.cpu ?? DEFAULT_SIDEKIQ_CPU,
  memoryLimitMiB: props.config.ecs.sidekiq?.memory ?? DEFAULT_SIDEKIQ_MEMORY,
  // ...
});

// スケジュールタスク: メインアプリのタスク定義を使用（変更なし）
```

### 3. 設定ファイル例（config/dev.json）

```json
{
  "ecs": {
    "smtpDomain": "diycities.jp",
    "repository": "decidim-cfj",
    "certificates": ["..."],
    "fargateSpotCapacityProvider": { "weight": 1 },
    "fargateCapacityProvider": { "base": 1, "weight": 2 },
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

## まとめ

このリサーチにより、以下が明確になりました：

1. **AWS Fargate制約**: CDKが自動検証するため、追加のバリデーションロジックは不要
2. **型定義**: オプショナルフィールドとNull合体演算子で後方互換性を保証
3. **設定適用**: 既存の`containerSpec`パターンを拡張し、設定ファイルから直接読み込み
4. **スケジュールタスク**: 現在はメインタスク定義を使用、将来の拡張に備えて設定インターフェースのみ提供

これらの決定事項に基づき、フェーズ1の設計とコントラクト作成に進むことができます。
