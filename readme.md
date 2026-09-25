# 群雄と約束 — 峠と収穫

1,000人の住民と兵士を同一人物として扱う、90日間のローカル戦略ゲームです。家族・文化・信用で返答が変わる家臣を率い、峠の商用通行権を条約または占領で獲得します。LLM接続なしで遊べます。

![実装済みの戦略画面](artifacts/strategy-screen.png)

## 起動

Node.js 22以上とnpmが必要です。リポジトリを取得して、プロジェクトのディレクトリで実行します。

```sh
npm ci
npm run dev
```

表示された `http://127.0.0.1:5173` を開き、「統治を始める」。外部APIキーやサーバー契約は不要です。

この作業環境のLinux版Nodeを使う場合は、先に `export PATH="$HOME/.local/node/bin:$PATH"` を実行してください。ほかの環境でNodeがすでに利用できる場合、この設定は不要です。

## 操作

- **地図**：拠点を選択。政策の大義、臨時徴税、志願兵の募集、通行交渉を行います。
- **人物**：アルノー、ミラなどの願いを面談で聞きます。遠方への面談は移動を伴い、後続の執務が遅れます。将軍交代は前任者の信用を損ないます。
- **約束**：相手・総額・期限・条件・保証金を指定。実際の支払いが本人へ伝わって初めて信用が変化します。ミラの家族扶助は遠征への協力にも影響します。
- **会戦**：部隊ごとに指揮官・目的地・補給・攻撃/撤退を指示。命令は伝令到着後に解釈され、拒否される場合があります。国庫の食糧は首都から運ぶ必要があります。
- **時間**：1時間、1日、連続進行/一時停止。重要報告で停止する設定があります。
- **振り返り**：届いた証言とその原因Eventをたどります。敵軍は推定、遠隔部隊は報告時点の情報です。
- **保存**：IndexedDBに保存。「JSON出力」で持ち出せます。起動画面からJSONを読み込めます。

初回は地図で「3,000通貨＋不可侵」を提案し、数日進めて外交の伝達を確認できます。軍事経路では志願兵を募り、部隊に食糧を送り、目的地「鷹爪の峠」への攻撃を指示します。徴兵は生産を減らし、戦死者は家族を持つ実在の住民です。

勝利条件は90日目の君主生存・首都保有・商用通行権です。何もしなければ通行権を得られず敗北します。

## 実装と検証

M0〜M2の機構受入とM3の自動シナリオは検証済みです。M3の正式受入に必要な3〜5人の人間試遊は未実施です。企画書全細目の完成版ではなく、共同市場などの簡略化があります。[状態と未実装範囲](docs/STATUS.md)、[判断記録](docs/DECISIONS.md)を参照してください。

| 段階 | 現在の状態 |
|---|---|
| M0：再現可能なコア | 100人30日、seed・Command再現、中間保存からの再開を検証済み |
| M1：生活・約束・徴兵 | 1,000人30日、資産保存、政策への個別反応、約束と信用、徴兵・復員を検証済み |
| M2：戦争と通信 | 200人の会戦追跡、地形・補給・配置・命令時刻による戦果差を検証済み |
| M3：90日シナリオ | 軍事・外交による勝利と無策による敗北を確認。人間試遊待ち |

2026-09-25の検証結果：単体・シナリオ **25/25成功**、ブラウザ **3/3成功**。型検査・本番ビルド・コンテンツ検査も成功しました。ブラウザ検証には保存・再開、90日進行、JSON読込、会戦表示、幅390pxの画面を含みます。[検証記録](artifacts/validation.json)を保存しています。

未実装の主な範囲は、個別市場、融資の元本実行、捕虜交換、自由布陣・医療、政治運動です。LLM実接続・出生継承・3D化・公開デプロイは今回の対象外です。


```sh
npm run typecheck
npm test
npm run build
npm run content:validate
npm run fixtures
npm run sim -- --scenario pass_and_harvest --seed 240924 --days 90
npm run sim -- --scenario pass_and_harvest --seed 240924 --days 90 --path military --record
npm run bench -- --profile world-1000 --days 100 --warmup-days 10
```

ブラウザ検証は `npx playwright install chromium` の後、`npm run test:browser`。本番ビルドをローカルで起動して検証します。`world-30000` はM6未対応としてエラーになります。1,000人の計測を大規模性能達成とは扱いません。

## サンプルと構成

- [外交成立・ミラへの約束が未履行の3日目セーブ](artifacts/sample-day3.json)
- [軍事経路4日目のセーブ](artifacts/sample-war-day4.json)
- [外交経路ログ](artifacts/diplomacy-run.json) / [軍事経路ログ](artifacts/military-run.json) / [無策の敗北ログ](artifacts/idle-run.json)
- [会戦対照実験](artifacts/combat-fixtures.json) / [性能測定](artifacts/benchmark.json)

`packages/sim` はDOM/UI/ネットワーク非依存、`contracts` は入力契約、`content` は固定設定、`ai` はObservationを受け取る通常AIとMock、`apps/web` はReact/Canvas/Workerです。世界状態の更新は検証されたCommandとシミュレーション内処理のみで行います。

設計原本は [DESIGN.md](docs/DESIGN.md)、出発点は [concept-original.md](docs/concept-original.md)。次の受入作業は [PLAYTEST.md](docs/PLAYTEST.md) です。Noto Sans JPはFontsource経由でローカル配信しています（SIL Open Font License、依存パッケージ内LICENSE参照）。

## 次の作業

1. [人間試遊の記録票](docs/PLAYTEST.md)を使い、3〜5人に30〜60分遊んでもらう。
2. [STATUS.md](docs/STATUS.md)の未実装項目と試遊で見つかった問題を優先して修正する。
3. M3の正式受入を確認してから、M4の政治運動・文化変化へ進む。
