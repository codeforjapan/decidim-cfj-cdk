# Decidim-cfj CDK

# Documentation

- 開発環境
  - [ビルド方法](docs/build_dev.md)

# CDK

```console
$ npx cdk --context stage=dev --profile decidim diff
```

## Useful commands

### Build & Test
- `npm run build` compile typescript to js
- `npm run watch` watch for changes and compile
- `npm run test` perform the jest unit tests

### Code Quality
- `npm run lint` check code with ESLint
- `npm run lint:fix` auto-fix ESLint issues
- `npm run format` format code with Prettier
- `npm run format:check` check code formatting
- `npm run check` run both format check and lint

### CDK Commands
- `cdk deploy` deploy this stack to your default AWS account/region
- `cdk diff` compare deployed stack with current state
- `cdk synth` emits the synthesized CloudFormation template

## Code Quality Tools

このプロジェクトでは、コード品質と一貫性を保つために **ESLint** と **Prettier** を使用しています。

### セットアップ

```bash
npm install
```

### 使い方

```bash
# コードをチェック
npm run lint

# 自動修正
npm run lint:fix

# フォーマット
npm run format

# すべてのチェックを実行
npm run check
```

### IDE統合（VS Code推奨）

以下の拡張機能をインストールすることを推奨します：
- ESLint (`dbaeumer.vscode-eslint`)
- Prettier - Code formatter (`esbenp.prettier-vscode`)

### 設定ファイル

- `.eslintrc.json` - ESLint設定
- `.prettierrc` - Prettier設定
- `.eslintignore` / `.prettierignore` - 除外ファイル設定
