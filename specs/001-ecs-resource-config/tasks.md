# 実装タスク: 環境別ECSリソース設定

**ブランチ**: `001-ecs-resource-config` | **日付**: 2026-01-18
**関連**: [spec.md](./spec.md) | [plan.md](./plan.md) | [data-model.md](./data-model.md)

## 概要

このタスクリストは、環境別ECSリソース設定機能の実装手順を定義します。各タスクはユーザーストーリーごとに整理され、独立してテスト・デプロイ可能です。

**MVP（最小実行可能製品）**: ユーザーストーリー1（メインアプリケーションの環境別CPU/メモリ設定）のみの実装で、基本的な価値を提供できます。

## 実装戦略

### フェーズ分割

1. **フェーズ1: セットアップ** - プロジェクトの初期化と準備
2. **フェーズ2: 基礎** - 全ユーザーストーリーに共通する基盤実装
3. **フェーズ3: US1 (P1)** - メインアプリケーションのリソース設定（MVP）
4. **フェーズ4: US2 (P2)** - Sidekiqワーカーのリソース設定
5. **フェーズ5: US3 (P3)** - スケジュールタスクの設定インターフェース（将来の拡張用）
6. **フェーズ6: 仕上げ** - ドキュメント更新とクロスカッティング

### 並列実行の機会

- US1、US2、US3は独立して実装可能（ただし、基礎フェーズ完了後）
- 各ユーザーストーリー内の[P]マーク付きタスクは並列実行可能
- テストタスクは実装完了後に並列実行可能

## タスク依存関係グラフ

```
フェーズ1: セットアップ
  └─→ フェーズ2: 基礎（型定義、インターフェース拡張）
       ├─→ フェーズ3: US1 (P1) - メインアプリ ← MVP
       ├─→ フェーズ4: US2 (P2) - Sidekiq    ← 独立実装可能
       └─→ フェーズ5: US3 (P3) - スケジュール ← 独立実装可能
            └─→ フェーズ6: 仕上げ
```

**注意**: US1完了後、US2とUS3は並列に実装できます。

---

## フェーズ1: セットアップ

### 目的

プロジェクトの初期化、ブランチ作成、既存コードの確認を行います。

### タスク

- [x] T001 feature ブランチ `001-ecs-resource-config` を作成・チェックアウト
- [x] T002 既存の設定ファイル構造を確認（config/\*.json、lib/config.ts、lib/decidim-stack.ts）
- [x] T003 既存のデフォルト値を確認（メインアプリ: CPU 2048/メモリ4096、Sidekiq: CPU 512/メモリ2048）

---

## フェーズ2: 基礎

### 目的

全ユーザーストーリーに共通する基盤コードを実装します。このフェーズ完了後、各ユーザーストーリーを独立して実装できます。

### タスク

- [ ] T004 [P] `EcsTaskResourceConfig` インターフェースを lib/config.ts に追加
- [ ] T005 [P] `EcsConfig` インターフェースに `mainApp?`, `sidekiq?`, `scheduledTasks?` フィールドを追加（lib/config.ts）
- [ ] T006 TypeScriptコードをビルドして型定義エラーがないことを確認（`npm run build`）
- [ ] T007 コード品質チェックを実行（`npm run check`）

---

## フェーズ3: ユーザーストーリー1（P1） - メインアプリケーションの環境別CPU/メモリ設定

### 目標

インフラ運用者が、メインDecidimアプリケーションタスクに環境ごとに異なるCPUとメモリを設定できるようにする。

### 独立したテスト基準

- dev.jsonに `ecs.mainApp.cpu: 1024, ecs.mainApp.memory: 2048` を設定
- prd-v0292.jsonに `ecs.mainApp.cpu: 4096, ecs.mainApp.memory: 8192` を設定
- `cdk synth`でCloudFormationテンプレートを生成し、タスク定義のCPU/メモリが設定値と一致することを確認
- 設定がない既存環境（staging.json）でデフォルト値（CPU 2048/メモリ4096）が使用されることを確認

### 実装タスク

- [ ] T008 [US1] デフォルト値定数を lib/decidim-stack.ts に定義（DEFAULT_MAIN_APP_CPU = 2048、DEFAULT_MAIN_APP_MEMORY = 4096）
- [ ] T009 [US1] `DecidimStackProps` インターフェースから `containerSpec` プロパティを削除（lib/decidim-stack.ts または lib/props.ts）
- [ ] T010 [US1] `DecidimStackProps` インターフェースに `config: Config` プロパティを追加（lib/props.ts）
- [ ] T011 [US1] メインアプリのタスク定義作成を修正し、`props.config.ecs.mainApp?.cpu ?? DEFAULT_MAIN_APP_CPU` を使用（lib/decidim-stack.ts の FargateTaskDefinition コンストラクタ）
- [ ] T012 [US1] メインアプリのタスク定義作成を修正し、`props.config.ecs.mainApp?.memory ?? DEFAULT_MAIN_APP_MEMORY` を使用（lib/decidim-stack.ts の FargateTaskDefinition コンストラクタ）
- [ ] T013 [US1] スタック呼び出し元（bin/decidim-cfj-cdk.ts）を修正し、`config` オブジェクト全体を `DecidimStack` に渡す
- [ ] T014 [US1] TypeScriptコードをビルド（`npm run build`）
- [ ] T015 [US1] dev 環境の設定ファイルに mainApp リソース設定を追加（config/dev.json に `"mainApp": {"cpu": 1024, "memory": 2048}` を追加）
- [ ] T016 [US1] `cdk --context stage=dev --context tag=test synth` を実行し、CloudFormationテンプレートの差分を確認
- [ ] T017 [US1] 生成されたテンプレートでメインアプリタスク定義のCPU/メモリが設定値（1024/2048）と一致することを確認
- [ ] T018 [US1] 後方互換性確認: staging.json（mainApp設定なし）で `cdk synth` を実行し、デフォルト値（2048/4096）が使用されることを確認
- [ ] T019 [US1] Jest スナップショットテストを更新して新しい設定構造を反映（test/decidim-cfj-cdk.test.ts）
- [ ] T020 [US1] すべてのテストを実行して合格することを確認（`npm run test`）
- [ ] T021 [US1] コード品質チェックを実行（`npm run check`）

### US1 並列実行例

T008-T012 は独立して実装可能（[P]マークはないが、異なる箇所を変更）。T015-T018 は検証タスクで並列実行可能。

---

## フェーズ4: ユーザーストーリー2（P2） - Sidekiqワーカーの環境別CPU/メモリ設定

### 目標

インフラ運用者が、Sidekiqバックグラウンドワーカータスクに環境ごとに異なるCPUとメモリを設定できるようにする。

### 独立したテスト基準

- staging.jsonに `ecs.sidekiq.cpu: 1024, ecs.sidekiq.memory: 2048` を設定
- `cdk synth`でSidekiqタスク定義のCPU/メモリが設定値と一致することを確認
- 設定がない環境でデフォルト値（CPU 512/メモリ2048）が使用されることを確認

### 実装タスク

- [ ] T022 [US2] デフォルト値定数を lib/decidim-stack.ts に定義（DEFAULT_SIDEKIQ_CPU = 512、DEFAULT_SIDEKIQ_MEMORY = 2048）
- [ ] T023 [US2] Sidekiqタスク定義作成を修正し、`props.config.ecs.sidekiq?.cpu ?? DEFAULT_SIDEKIQ_CPU` を使用（lib/decidim-stack.ts の sidekiqTaskDefinition）
- [ ] T024 [US2] Sidekiqタスク定義作成を修正し、`props.config.ecs.sidekiq?.memory ?? DEFAULT_SIDEKIQ_MEMORY` を使用（lib/decidim-stack.ts の sidekiqTaskDefinition）
- [ ] T025 [US2] TypeScriptコードをビルド（`npm run build`）
- [ ] T026 [US2] staging 環境の設定ファイルに sidekiq リソース設定を追加（config/staging.json に `"sidekiq": {"cpu": 1024, "memory": 2048}` を追加）
- [ ] T027 [US2] `cdk --context stage=staging --context tag=test synth` を実行し、CloudFormationテンプレートを生成
- [ ] T028 [US2] 生成されたテンプレートでSidekiqタスク定義のCPU/メモリが設定値（1024/2048）と一致することを確認
- [ ] T029 [US2] 後方互換性確認: dev.json（sidekiq設定なし）で `cdk synth` を実行し、デフォルト値（512/2048）が使用されることを確認
- [ ] T030 [US2] Jest スナップショットテストを更新（test/decidim-cfj-cdk.test.ts）
- [ ] T031 [US2] すべてのテストを実行して合格することを確認（`npm run test`）
- [ ] T032 [US2] コード品質チェックを実行（`npm run check`）

### US2 並列実行例

T022-T024 は US1 完了後に並列実行可能。T026-T029 は検証タスクで並列実行可能。

---

## フェーズ5: ユーザーストーリー3（P3） - スケジュールタスクの設定インターフェース

### 目標

将来の拡張に備えて、`scheduledTasks` 設定インターフェースを提供する。現在の実装ではメインアプリのタスク定義を使用し続ける。

### 独立したテスト基準

- quickstart.mdに「スケジュールタスクは現在メインアプリのタスク定義を使用」と明記されていることを確認
- `scheduledTasks` フィールドが `EcsConfig` インターフェースに存在することを確認
- 設定ファイルに `scheduledTasks` を追加してもエラーが発生しないことを確認

### 実装タスク

- [ ] T033 [US3] quickstart.md にスケジュールタスクの現在の動作を文書化（「スケジュールタスクはメインアプリのタスク定義を使用」）
- [ ] T034 [US3] quickstart.md に `scheduledTasks` 設定フィールドが将来の拡張用であることを明記
- [ ] T035 [US3] quickstart.md にスケジュールタスクのリソースを調整する方法を記載（「`mainApp` 設定を変更する」）
- [ ] T036 [US3] dev.json に `scheduledTasks` 設定例をコメントとして追加（将来の参照用）
- [ ] T037 [US3] TypeScriptコードをビルド（`npm run build`）
- [ ] T038 [US3] `cdk --context stage=dev --context tag=test synth` を実行し、エラーが発生しないことを確認
- [ ] T039 [US3] コード品質チェックを実行（`npm run check`）

### US3 並列実行例

T033-T035 はドキュメント更新で並列実行可能。US1とUS2完了後に実装できます。

---

## フェーズ6: 仕上げとクロスカッティング

### 目的

全環境の設定ファイル更新、ドキュメント整備、最終検証を行います。

### タスク

- [ ] T040 [P] prd-v0292.json に mainApp と sidekiq のリソース設定を追加（本番環境用の値: mainApp cpu=4096, memory=8192, sidekiq cpu=2048, memory=4096）
- [ ] T041 [P] dev2.json に mainApp と sidekiq のリソース設定を追加（開発環境用の値: mainApp cpu=1024, memory=2048, sidekiq cpu=512, memory=1024）
- [ ] T042 CLAUDE.md を更新し、ECSリソース設定の追加方法を記載
- [ ] T043 CLAUDE.md にAWS Fargate有効なCPU/メモリ組み合わせ表を追加
- [ ] T044 各環境設定ファイル（dev, staging, prd-v0292, dev2）で `cdk diff` を実行し、期待通りの差分を確認
- [ ] T045 全環境でTypeScriptビルドが成功することを確認（`npm run build`）
- [ ] T046 全環境でテストが合格することを確認（`npm run test`）
- [ ] T047 コード品質チェックを実行（`npm run lint` および `npm run format:check`）
- [ ] T048 コミット前に全チェックを実行（`npm run check`）
- [ ] T049 変更をコミット（日本語のコミットメッセージ: 「feat: 環境別ECSリソース設定を追加\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>」）

---

## タスク統計

- **総タスク数**: 49
- **セットアップ**: 3タスク
- **基礎**: 4タスク
- **US1 (P1)**: 14タスク（MVP）
- **US2 (P2)**: 11タスク
- **US3 (P3)**: 7タスク
- **仕上げ**: 10タスク

## 並列実行の機会

### フェーズ2: 基礎

- T004とT005は並列実行可能（異なるインターフェース定義）

### フェーズ3: US1

- T015-T018（検証タスク）は環境ごとに並列実行可能

### フェーズ4: US2

- US1完了後、US2全体を並列実行可能
- T026-T029（検証タスク）は環境ごとに並列実行可能

### フェーズ5: US3

- US1とUS2完了後、US3全体を並列実行可能
- T033-T035（ドキュメント更新）は並列実行可能

### フェーズ6: 仕上げ

- T040とT041（設定ファイル更新）は並列実行可能
- T044-T047（検証タスク）は並列実行可能

## MVP（最小実行可能製品）スコープ

**推奨MVPスコープ**: フェーズ1、2、3（US1のみ）

これにより以下が達成できます：

- メインアプリケーションの環境別CPU/メモリ設定
- dev環境でコスト最適化（50%リソース削減）
- prd-v0292環境で高性能設定（2倍リソース）
- 後方互換性の維持（既存環境への影響なし）

US2とUS3は、MVP検証後に段階的に追加できます。

## 実装順序の推奨

1. **MVP先行**: フェーズ1 → フェーズ2 → フェーズ3（US1）→ dev環境でテスト
2. **段階的拡張**: フェーズ4（US2）→ staging環境でテスト
3. **将来準備**: フェーズ5（US3）→ ドキュメント整備
4. **全環境展開**: フェーズ6（仕上げ）→ 全環境デプロイ

## 完了基準

すべてのタスクが完了し、以下が確認できたら、この機能は完了です：

1. ✅ すべての環境でTypeScriptビルドが成功
2. ✅ すべてのJestテストが合格
3. ✅ ESLintとPrettierチェックが合格
4. ✅ 各環境で`cdk synth`が成功し、期待通りのCloudFormationテンプレートが生成される
5. ✅ 後方互換性が維持されている（設定なしの環境でデフォルト値が使用される）
6. ✅ ドキュメント（CLAUDE.md、quickstart.md）が更新されている
7. ✅ 各ユーザーストーリーの独立したテスト基準を満たしている

## 次のステップ

このタスクリスト完了後：

1. **実装実行**: `/speckit.implement` コマンドでタスクを実行
2. **dev環境でテスト**: MVP（US1）をdev環境にデプロイしてテスト
3. **段階的展開**: US2、US3を追加し、staging → production の順にデプロイ
4. **モニタリング**: CloudWatch メトリクスでCPU/メモリ使用率を監視し、設定を最適化
