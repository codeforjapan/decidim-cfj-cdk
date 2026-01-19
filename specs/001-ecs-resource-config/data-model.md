# データモデル: 環境別ECSリソース設定

**日付**: 2026-01-18
**フェーズ**: フェーズ1 - 設計とコントラクト
**関連**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md)

## 概要

この機能は、環境ごとに異なるECSタスクのCPUとメモリリソースを設定可能にします。データモデルは設定ファイル（JSON）とTypeScript型定義で構成されます。

## エンティティ定義

### 1. EcsTaskResourceConfig

ECSタスクのCPUとメモリリソース割り当てを表すインターフェース。

**TypeScript型定義**:

```typescript
/**
 * ECSタスクのリソース設定
 */
export interface EcsTaskResourceConfig {
  /**
   * CPU割り当て（CPU単位）
   * - 1024単位 = 1 vCPU
   * - 有効な値: 256, 512, 1024, 2048, 4096, 8192, 16384
   * - オプショナル: 指定しない場合はデフォルト値を使用
   */
  cpu?: number;

  /**
   * メモリ割り当て（MiB）
   * - CPUとメモリの組み合わせはAWS Fargateの制限に従う必要がある
   * - オプショナル: 指定しない場合はデフォルト値を使用
   */
  memory?: number;
}
```

**フィールド詳細**:

| フィールド | 型     | 必須   | 説明                   | 制約                                                             |
| ---------- | ------ | ------ | ---------------------- | ---------------------------------------------------------------- |
| cpu        | number | いいえ | CPU割り当て（CPU単位） | AWS Fargateの有効な値（256, 512, 1024, 2048, 4096, 8192, 16384） |
| memory     | number | いいえ | メモリ割り当て（MiB）  | CPUに応じた有効な範囲内                                          |

**検証ルール**:

1. **オプショナル**: 両フィールドともオプショナル。指定しない場合はデフォルト値を使用
2. **部分的指定**: CPUのみ、またはメモリのみを指定可能
3. **AWS Fargate制約**: CPUとメモリの組み合わせはAWS Fargateの制限に従う（CDKが合成時に検証）
4. **正の整数**: 両フィールドとも正の整数値

**デフォルト値**:

| タスクタイプ       | デフォルトCPU      | デフォルトメモリ   |
| ------------------ | ------------------ | ------------------ |
| メインアプリ       | 2048 (2 vCPU)      | 4096 (4 GiB)       |
| Sidekiq            | 512 (0.5 vCPU)     | 2048 (2 GiB)       |
| スケジュールタスク | メインアプリと同じ | メインアプリと同じ |

### 2. EcsConfig（拡張）

既存の`EcsConfig`インターフェースを拡張し、タスクタイプごとのリソース設定を追加。

**TypeScript型定義**:

```typescript
export interface EcsConfig {
  // ========== 既存フィールド ==========
  smtpDomain: string;
  repository: string;
  certificates: string[];
  fargateCapacityProvider: capacityProviderStrategy;
  fargateSpotCapacityProvider: capacityProviderStrategy;

  // ========== 新規フィールド ==========
  /**
   * メインDecidimアプリケーションタスクのリソース設定
   * - オプショナル: 指定しない場合はデフォルト値（CPU: 2048, memory: 4096）を使用
   */
  mainApp?: EcsTaskResourceConfig;

  /**
   * Sidekiqワーカータスクのリソース設定
   * - オプショナル: 指定しない場合はデフォルト値（CPU: 512, memory: 2048）を使用
   */
  sidekiq?: EcsTaskResourceConfig;

  /**
   * スケジュールされたメンテナンスタスクのリソース設定
   * - 注意: 現在の実装ではメインアプリのタスク定義を使用
   * - このフィールドは将来の独立した設定のために予約されている
   * - オプショナル: 現在は使用されない
   */
  scheduledTasks?: EcsTaskResourceConfig;
}
```

**フィールド詳細**:

| フィールド     | 型                    | 必須   | 説明                                 | 使用箇所                       |
| -------------- | --------------------- | ------ | ------------------------------------ | ------------------------------ |
| mainApp        | EcsTaskResourceConfig | いいえ | メインアプリのリソース               | DecidimStack タスク定義        |
| sidekiq        | EcsTaskResourceConfig | いいえ | Sidekiqのリソース                    | DecidimStack Sidekiqタスク定義 |
| scheduledTasks | EcsTaskResourceConfig | いいえ | スケジュールタスクのリソース（予約） | 将来の使用のために予約         |

### 3. Config（既存、変更なし）

既存の`Config`インターフェースは変更なし。`ecs`フィールドは拡張された`EcsConfig`を使用。

```typescript
export interface Config {
  stage: string;
  vpc?: VpcConfig;
  aws: {
    accountId: string;
    region: string;
  };
  s3Bucket: string;
  rds: RdsConfig;
  cacheNodeType: string;
  engineVersion: string;
  numCacheNodes: number;
  automaticFailoverEnabled: boolean;
  ecs: EcsConfig; // 拡張されたEcsConfigを使用
  domain: string;
  cloudfrontCertificate: string;
}
```

## リレーションシップ

```
Config
  └── ecs: EcsConfig
       ├── mainApp?: EcsTaskResourceConfig
       ├── sidekiq?: EcsTaskResourceConfig
       └── scheduledTasks?: EcsTaskResourceConfig (予約)
```

**説明**:

- `Config`は環境全体の設定を表す
- `EcsConfig`はECS関連の設定を含む
- 各タスクタイプ（mainApp、sidekiq）は独立した`EcsTaskResourceConfig`を持つ
- すべてのリソース設定はオプショナル（後方互換性のため）

## 状態遷移

該当なし。この機能は静的な設定であり、実行時の状態遷移はありません。

## JSON設定ファイル構造

### 最小構成（後方互換性）

新しいフィールドを追加しない場合、既存の設定ファイルはそのまま有効：

```json
{
  "ecs": {
    "smtpDomain": "diycities.jp",
    "repository": "decidim-cfj",
    "certificates": ["arn:aws:acm:..."],
    "fargateSpotCapacityProvider": { "weight": 1 },
    "fargateCapacityProvider": { "base": 1, "weight": 2 }
  }
}
```

デフォルト値が使用されます:

- メインアプリ: CPU 2048, メモリ4096
- Sidekiq: CPU 512, メモリ2048

### フル構成（新しいリソース設定あり）

```json
{
  "ecs": {
    "smtpDomain": "diycities.jp",
    "repository": "decidim-cfj",
    "certificates": ["arn:aws:acm:..."],
    "fargateSpotCapacityProvider": { "weight": 1 },
    "fargateCapacityProvider": { "base": 1, "weight": 2 },
    "mainApp": {
      "cpu": 4096,
      "memory": 8192
    },
    "sidekiq": {
      "cpu": 1024,
      "memory": 2048
    }
  }
}
```

### 部分的設定

CPUのみ、またはメモリのみを指定することも可能：

```json
{
  "ecs": {
    "smtpDomain": "diycities.jp",
    "repository": "decidim-cfj",
    "certificates": ["arn:aws:acm:..."],
    "fargateSpotCapacityProvider": { "weight": 1 },
    "fargateCapacityProvider": { "base": 1, "weight": 2 },
    "mainApp": {
      "cpu": 4096
      // memoryは指定なし → デフォルト4096を使用
    }
  }
}
```

## 実装への対応付け

### TypeScriptコード（lib/config.ts）

```typescript
// 新しいインターフェースを追加
export interface EcsTaskResourceConfig {
  cpu?: number;
  memory?: number;
}

// 既存のEcsConfigを拡張
export interface EcsConfig {
  smtpDomain: string;
  repository: string;
  certificates: string[];
  fargateCapacityProvider: capacityProviderStrategy;
  fargateSpotCapacityProvider: capacityProviderStrategy;
  mainApp?: EcsTaskResourceConfig;
  sidekiq?: EcsTaskResourceConfig;
  scheduledTasks?: EcsTaskResourceConfig;
}
```

### CDKスタック（lib/decidim-stack.ts）

```typescript
// デフォルト値定数
const DEFAULT_MAIN_APP_CPU = 2048;
const DEFAULT_MAIN_APP_MEMORY = 4096;
const DEFAULT_SIDEKIQ_CPU = 512;
const DEFAULT_SIDEKIQ_MEMORY = 2048;

// メインアプリタスク定義
const taskDefinition = new ecs.FargateTaskDefinition(this, 'decidimTaskDefinition', {
  cpu: props.config.ecs.mainApp?.cpu ?? DEFAULT_MAIN_APP_CPU,
  memoryLimitMiB: props.config.ecs.mainApp?.memory ?? DEFAULT_MAIN_APP_MEMORY,
  // ...
});

// Sidekiqタスク定義
const sidekiqTaskDefinition = new ecs.FargateTaskDefinition(this, 'sidekiqTaskDefinition', {
  cpu: props.config.ecs.sidekiq?.cpu ?? DEFAULT_SIDEKIQ_CPU,
  memoryLimitMiB: props.config.ecs.sidekiq?.memory ?? DEFAULT_SIDEKIQ_MEMORY,
  // ...
});
```

## AWS Fargate CPU/メモリ有効な組み合わせ

参考として、AWS Fargateで許可されているCPU/メモリの組み合わせ：

| CPU (CPU units) | メモリ (MiB) の範囲                                                                 |
| --------------- | ----------------------------------------------------------------------------------- |
| 256 (.25 vCPU)  | 512, 1024, 2048                                                                     |
| 512 (.5 vCPU)   | 1024, 2048, 3072, 4096                                                              |
| 1024 (1 vCPU)   | 2048, 3072, 4096, 5120, 6144, 7168, 8192                                            |
| 2048 (2 vCPU)   | 4096, 5120, 6144, 7168, 8192, 9216, 10240, 11264, 12288, 13312, 14336, 15360, 16384 |
| 4096 (4 vCPU)   | 8192 - 30720 (1024単位)                                                             |
| 8192 (8 vCPU)   | 16384 - 61440 (4096単位)                                                            |
| 16384 (16 vCPU) | 32768 - 122880 (8192単位)                                                           |

**注意**: 無効な組み合わせを指定した場合、AWS CDKが`cdk synth`時にエラーを発生させます。

## まとめ

このデータモデルにより：

1. **型安全性**: TypeScriptの型定義により、設定ファイルの構造を保証
2. **後方互換性**: オプショナルフィールドにより、既存の設定ファイルに影響なし
3. **柔軟性**: タスクタイプごとに独立してリソースを設定可能
4. **シンプル**: 最小限のインターフェース拡張で実現
5. **将来の拡張**: `scheduledTasks`フィールドで将来の独立した設定に備える
