# BugGPS · dsh-bug-gps

[简体中文](../../README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md)

**問題を記録し、元の期待どおりに修正されたか確かめる。**

BugGPS は DeepSeek Harness（DSH）のプラグインです。すでに見つかっているブラウザー上の不具合を対象に、操作と期待する結果を記録し、再現可能な失敗を固定します。修正後も同じ条件と独立したベースラインで確認します。

> プレリリースです。npm パッケージは未公開のため、以下ではローカルのソースを使います。現在の互換性確認対象は DSH **0.2.1-rc.5** のみです。

![BugGPS](../media/buggps-demo.gif)

デモは付属の不具合入りサンプルをスクリプトで操作し、用意した変更を適用しています。画面とツールの出力は実行結果ですが、キーフレームを編集しているため動画の長さは処理時間を表しません。結果カード、カーソル、字幕は演出用の重ね表示です。

## 付属サンプルを試す

Node.js ≥20、Git、インストール済みの Microsoft Edge または Google Chrome が必要です。記録済みの Windows 検証は Node 24.22.0 と Edge 156 を使用しています。他のすべての環境での動作を示すものではありません。

```bash
git clone --branch test/release-integration --single-branch https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps.git
cd dsh-bug-gps
npm ci
node bin/buggps.js demo ../buggps-demo
node bin/buggps.js doctor --repo ../buggps-demo
```

`demo` は独立した Git リポジトリを作成し、次の操作を表示します。開発サーバーを起動し、そのプロジェクトを DSH で開いて、不具合と期待する結果を記録します。`doctor` は実行環境、ブラウザー、コマンド、設定、ポートを確認します。既存の草稿は再録せずに固定できます。

## DSH に読み込む

`dsh plugin` で読み込む場合は、PATH 上の **pnpm ≥10** も必要です。

```bash
dsh plugin --profile PROFILE add "/absolute/path/to/dsh-bug-gps"
dsh --profile PROFILE --dump-config
```

`PROFILE` は実際に使っているプロファイル、パスはチェックアウト先の絶対パスに置き換えてください。対応する DSH を再起動し、対象プロジェクトで `buggps_status` を呼び出します。設定への登録だけではツールの読み込み成功を確認できません。

デスクトップ版と CLI は別のプロファイルを使う場合があります。`web` へのインストールだけでデスクトップ版への導入完了とはいえません。内蔵 DSH のバージョンと実際のプロファイルを確認してから、アプリのプラグイン管理を使ってください。公式 rc.5 CLI の動作は確認済みですが、デスクトップへの導入経路は個別の受け入れ確認が未完了です。

## 流れ

1. **記録：** 操作、ブラウザー設定、明示した期待結果を保存します。チェックポイントは途中の状態を、重要ステップは短縮時に残す操作を指定します。
2. **固定：** 保存した `serve` コマンドでアプリを起動し、同じ失敗が 3 回（既定値）起きることを確かめます。
3. **修正：** DSH が既存の設定を使ってアプリのソースを変更します。
4. **検証：** 完全な記録を元の条件で 3 回（既定値）再生します。独立したベースラインでも元の失敗が再現して初めて `VERIFIED` とします。

## 結果の読み方

| 判定 | 意味 |
|---|---|
| `VERIFIED` | 記録した条件が成立し、新しいベースライン対照でも元の失敗を再現できました。 |
| `PASSED_UNBOUND` | 外部サーバーでは通過しましたが、実行中のコードとパッチを結び付けられません。 |
| `NEEDS_REVIEW` | 操作の無効化、否定条件のみ、ロケーター候補の変更、検査器の変更、ベースライン不一致などにより確認が必要です。 |
| `STILL_FAILING / DIFFERENT_FAILURE` | 元の失敗が続いている、または別の症状・途中条件で失敗しています。 |
| `TEST_INVALID / ENV_BLOCKED` | 検査定義が実行できない、または環境が利用できません。不具合の再現成功ではありません。 |
| `FLAKY / STALE / CASE_TAMPERED` | 結果の不一致、検証中のコード変更、固定した証拠の変更を検出しました。 |
| `NO_CODE_CHANGE` | 固定後にコードの変更がなく、検証する修正がありません。 |
| `BUDGET_EXHAUSTED / ABORTED` | 予算上限またはキャンセルにより、証拠が揃っていません。 |

## 対象範囲と制限

- 検証結果は記録した場面に限ります。他の不具合がないことの証明ではありません。
- 毎回リセットできるフロントエンド状態が対象です。計測前に 1 回予備再生するため、サーバー側のデータを変更する操作は対象外です。
- 最終条件は既定で 1,000 ms、目標間隔 50 ms で確認します。サンプリングの隙間や観測期間の外は対象外です。
- 短縮は予算内で確認できた短い経路です。完全な記録を判定の基準とし、大域的な最短経路や因果関係は保証しません。
- スナップショットは Git に従い、無視された依存関係や設定を含みません。ベースラインの共有依存関係と環境入力は別に記録します。worktree はセキュリティ用のサンドボックスではありません。
- 機密らしい入力は環境変数の参照として保存しますが、検出は完全ではありません。共有前に成果物を確認してください。
- 定義と記録の整合性を確認します。shell の保護は可能な範囲での対策であり、ハッシュだけで偽造を防げるわけではありません。

[設定・全判定・詳細な制限](../../README.md)

## 証拠とフィードバック

テスト、配布パッケージ、固定した 12 件の回帰ケースは別々に記録します。過去のケースは実装の改善にも使われた拡張回帰セットであり、未知の評価セットではありません。失敗も分母に残します。

[ケースの手引き](../../bench/RECORDING-GUIDE.md) · [実行記録](../../bench/results) · [ブラウザー回帰テスト](../../test/counterexamples.test.js) · [問題を報告](https://github.com/lijiaqi-AI-Product-Manager/dsh-bug-gps/issues/new)

DSH のバージョン、OS、期待する動作、実際の判定、安全に共有できる再現手順を記載し、認証情報と非公開データを除いてください。

修正の確認に役立ったら、Star で応援していただけるとうれしいです。

MIT · [LICENSE](../../LICENSE)


[外部プロジェクト ChartDB の修正を再検証](../../bench/repairs/chartdb-dbml-index/README.md) · [DSH rc.5](../../bench/results/account-project-chartdb-dbml-index-2026-11-03.json) · [ChartDB の検証用ファイル: AGPLv3](../../bench/repairs/chartdb-dbml-index/LICENSE)
