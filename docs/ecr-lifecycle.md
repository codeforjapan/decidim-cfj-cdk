# ECR ライフサイクルポリシー

`decidim-cfj` リポジトリのライフサイクルポリシーを、このリポジトリで管理するための仕組みと背景。

正本: [`ecr/decidim-cfj-lifecycle-policy.json`](../ecr/decidim-cfj-lifecycle-policy.json)

## ⚠️ ルールの優先度を変えないでください

**`prd-` は必ず `staging-` より前（小さい `rulePriority`）に置いてください。**

この順序は本番停止の再発防止そのものです。理由は後述します。

## なぜ CDK（CloudFormation）で管理しないのか

理由が2つあります。

**1. `decidim-cfj` は 3 ステージ共有の単一リソースです**

```
config/dev.json        → decidim-cfj
config/staging.json    → decidim-cfj
config/prd-v030.json   → decidim-cfj
```

CDK はステージ別にスタックが分かれているため、どれか1つに所有させると「dev のデプロイが本番のイメージ保持に影響する」構造になります。CDK 側は `decidim-stack.ts` で `Repository.fromRepositoryName()` による参照にとどめており、これは意図的です。

**2. 誤って消える経路を作りたくない**

CDK が作っている nginx リポジトリはこうなっています。

```typescript
const repo = new Repository(this, 'repo', {
  repositoryName: `${props.stage}-${props.serviceName}-nginx-repository`,
  removalPolicy: RemovalPolicy.DESTROY,
});
```

同じ扱いで `decidim-cfj` を取り込むと、スタック削除やリソース置換で**全イメージが消えます**。本番イメージの置き場でそれは避けたい。

そこで **CloudFormation には所有させず、ポリシー本体だけをコード管理**しています。

## 使い方

```bash
# 現行ポリシーと正本を比較（読み取りのみ）
npm run ecr:policy:diff

# 正本を適用
npm run ecr:policy:apply -- --yes
```

環境変数で対象を変えられます（既定: `decidim-cfj` / `ap-northeast-1`）。

```bash
ECR_REPOSITORY=other-repo AWS_REGION=ap-northeast-1 npm run ecr:policy:diff
```

CI（`.github/workflows/ecr_policy_drift.yml`）が main への push・`ecr/` を触る PR・毎週月曜にドリフトを検査します。**検知するだけで、自動適用はしません。**

ポリシーを変えたいときは「正本を編集 → PR → マージ → `apply`」の順です。コンソールから直接変更すると次の CI で落ちます。

## 背景: 2026-09-19 の本番停止

本番が全停止しました。ECS が以下で失敗し続けた状態です。

```
CannotPullContainerError: ... decidim-cfj:prd-v030-v1.21.1@sha256:3d59bc71... not found
```

原因は3段の連鎖でした。

**① `provenance: false` の導入（decidim-cfj `0a2c7f9d`, 2026-05-12）**

buildx の更新ついでに入れた設定です。変更前は push されるのが **image index**（image manifest + attestation manifest）で、attestation にビルド時刻や実行 ID が入るため **index の digest はビルド毎に必ず変化**していました。変更後は**単一マニフェスト**になり、digest が純粋なコンテンツハッシュになりました。

**② prd と staging が同一イメージになった**

`cache-from: type=gha` が効いているため、release-please のマージコミットは直前の staging ビルドと**完全に同一のレイヤ**を produce します。結果、ECR は既存マニフェストにタグを足すだけの動作になりました。

```
sha256:3d59bc71...  →  ['staging-e6ee8f9', 'prd-v030-v1.21.1']
```

`prd-v030-v1.19.0` 〜 `v1.21.2` は**すべて**この形です。

**③ ライフサイクルの優先度が逆だった**

ECR は、複数ルールにマッチするイメージを**優先度が最小のルール1つだけ**で処理します。タグ単位の保持は行われません。当時の設定はこうでした。

```
rulePriority 2 : staging-  → 5 件保持    ← こちらが勝っていた
rulePriority 3 : prd-      → 10 件保持   ← 一度も発火していなかった
```

`prd-v030-*` は `staging-` タグも持つため **staging の回転で巻き添え削除**され、本番が参照していたイメージごと消えました。

裏付けとして、`prd-` タグは累計 14 件ありましたが、古い 4 件は消えていませんでした。`prd-` ルールが一度も適用されていなかった証拠です。

## 調査時のメモ

- **ECR ライフサイクルによる削除は CloudTrail に記録されません。** 90 日分をページングしても `BatchDeleteImage` / `DeleteImage` はゼロでした。手動削除と切り分けるにはこれを知っている必要があります。
- 消えた/残ったイメージの**タグ構成**を見るのが決め手です。`describe-images` の `imageTags` と CloudTrail `PutImage` の digest を突き合わせると、digest 共有が一目で分かります。
- ECR に **0.0 MB の untagged イメージ**が並んでいたら provenance 有効時代の attestation manifest です。これが途切れた時期が `provenance: false` の投入時期にあたります。
- タスク定義がタグ指定でも、**ECS はデプロイ時に解決した digest を保持します**。同じタグで push し直すだけでは復旧せず、`force-new-deployment` が必要です。

## 残っている課題

- **`prd-` の上限 10 のうち 7 件が旧 `prd-v0292-*`（2026-02〜05）です。** v030 への移行は完了しているため整理してよく、整理すれば新リリース3回で上限に達する窮屈さが解消します。
- prd / staging のリポジトリ分離は、タグ空間の交差そのものを無くせる点で最も堅い対策です。ただし優先度の修正で今回の問題は構造的に解消しているため、必須ではありません。
