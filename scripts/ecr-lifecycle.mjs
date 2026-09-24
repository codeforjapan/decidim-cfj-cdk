#!/usr/bin/env node
/**
 * ECR ライフサイクルポリシーをコード管理するための diff / apply スクリプト。
 *
 * decidim-cfj リポジトリは dev / staging / prd-v030 の 3 ステージが共有しているため、
 * ステージ別に分かれている CDK スタックのいずれかに所有させる形にはできない。
 * （CDK が作る nginx リポジトリは removalPolicy: DESTROY なので、同じ扱いにすると
 *   スタック削除で全イメージが消える）
 * そのため CloudFormation には所有させず、ポリシー本体だけをこのリポジトリで管理する。
 *
 * 詳細と背景: docs/ecr-lifecycle.md
 *
 *   npm run ecr:policy:diff          現行ポリシーと正本を比較（読み取りのみ）
 *   npm run ecr:policy:apply -- --yes 正本を適用
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPOSITORY = process.env.ECR_REPOSITORY ?? 'decidim-cfj';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

const here = dirname(fileURLToPath(import.meta.url));
const POLICY_FILE = join(here, '..', 'ecr', `${REPOSITORY}-lifecycle-policy.json`);

/**
 * 比較用に正規化する。ECR は rulePriority 順を保証せず、キー順も往復で変わりうるため、
 * ルールを優先度で並べ替えたうえでキーを再帰的にソートしてから文字列化する。
 */
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const canonicalJson = (policy) => {
  const rules = [...(policy.rules ?? [])].sort((a, b) => a.rulePriority - b.rulePriority);
  return JSON.stringify(canonicalize({ rules }), null, 2);
};

const aws = (args) =>
  execFileSync('aws', [...args, '--region', REGION], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

const desiredPolicy = () => JSON.parse(readFileSync(POLICY_FILE, 'utf8'));

/** 未設定なら null を返す。設定済みなら現行ポリシーを返す。 */
const currentPolicy = () => {
  try {
    const raw = aws(['ecr', 'get-lifecycle-policy', '--repository-name', REPOSITORY, '--query', 'lifecyclePolicyText', '--output', 'text']);
    return JSON.parse(raw.trim());
  } catch (error) {
    const message = `${error.stderr ?? ''}${error.message ?? ''}`;
    if (message.includes('LifecyclePolicyNotFoundException')) return null;
    throw error;
  }
};

/** 差分のある行だけを前後 2 行つきで表示する簡易差分。 */
const printDiff = (before, after) => {
  const a = before.split('\n');
  const b = after.split('\n');
  const width = Math.max(a.length, b.length);
  const changed = [];
  for (let i = 0; i < width; i += 1) {
    if (a[i] !== b[i]) changed.push(i);
  }
  const show = new Set();
  for (const i of changed) {
    for (let j = Math.max(0, i - 2); j <= Math.min(width - 1, i + 2); j += 1) show.add(j);
  }
  let previous = -1;
  for (const i of [...show].sort((x, y) => x - y)) {
    if (previous >= 0 && i > previous + 1) console.log('  ...');
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) console.log(`- ${a[i]}`);
      if (b[i] !== undefined) console.log(`+ ${b[i]}`);
    } else {
      console.log(`  ${a[i]}`);
    }
    previous = i;
  }
};

const main = () => {
  const command = process.argv[2];
  if (command !== 'diff' && command !== 'apply') {
    console.error('usage: ecr-lifecycle.mjs <diff|apply> [--yes]');
    process.exit(2);
  }

  const desired = desiredPolicy();
  const current = currentPolicy();
  const desiredText = canonicalJson(desired);
  const currentText = current === null ? '' : canonicalJson(current);

  console.log(`repository: ${REPOSITORY} (${REGION})`);
  console.log(`policy file: ${POLICY_FILE}`);

  if (currentText === desiredText) {
    console.log('\n✅ 現行ポリシーは正本と一致しています。');
    return;
  }

  console.log(current === null ? '\n⚠️  ポリシーが未設定です。\n' : '\n⚠️  差分があります（- 現行 / + 正本）\n');
  printDiff(currentText, desiredText);

  if (command === 'diff') {
    console.error('\n❌ ドリフトを検出しました。コンソールから手動変更された可能性があります。');
    console.error('   正本が正しければ `npm run ecr:policy:apply -- --yes` を、');
    console.error('   AWS 側が正しければ ecr/ のファイルを更新してください。');
    process.exit(1);
  }

  if (!process.argv.includes('--yes')) {
    console.error('\n適用するには --yes を付けてください: npm run ecr:policy:apply -- --yes');
    process.exit(1);
  }

  aws(['ecr', 'put-lifecycle-policy', '--repository-name', REPOSITORY, '--lifecycle-policy-text', JSON.stringify(desired)]);
  console.log('\n✅ 適用しました。lastEvaluatedAt はリセットされ、次回評価から新ポリシーが効きます。');
};

try {
  main();
} catch (error) {
  // aws CLI の失敗をそのまま投げるとスタックトレースに埋もれるため、標準エラーだけを見せる。
  const detail = `${error.stderr ?? ''}`.trim();
  console.error(`\n❌ 実行できませんでした。\n${detail || error.message}`);
  if (detail.includes('ExpiredToken') || detail.includes('InvalidClientTokenId')) {
    console.error('\n   認証が切れています。`aws-mfa --profile decidim` で更新してください。');
  }
  process.exit(2);
}
