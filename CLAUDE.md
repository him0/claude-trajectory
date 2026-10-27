# claude-trajectory

Claude Code の mod。セッションの system prompt・ユーザー入力・注入コンテキスト・応答・thinking・ツール呼び出しを 1 本のタイムラインとしてペインに表示する。

## 構成

- `hooks/register.tsx`: hooks モジュール本体（記録とペインの描画）
- `hooks/trajectory.test.tsx`: `claude plugin test` で動くテスト
- `types/index.d.ts`: `$.state` の型コントラクト。atom を足したらここにも宣言する
- `.claude-plugin/plugin.json`: バージョンはリリースごとに上げる

## 確認コマンド

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```

## 注意点

- 組織管理下の環境では `prompt.compose` と `prompt.context` のフックが呼ばれない。`/trajectory` を開いたときに system prompt と CLAUDE.md を取り直すフォールバックを残しておく。
- `cc-plugin-sec-default` が読み込まれていると、`session.start` で userConfig の `skipManagedHooks` を自動で true にし、再読み込み後は `prompt.compose`・`prompt.context`・`session.append` を登録しない。自動で false に戻すことはしない（再読み込み時の `engine.create` には自分しか渡らないため）。
- CLAUDE.md などの context blocks は送信時に先頭のユーザーメッセージへ付け足されるため、`session.append` には流れてこない。
- コメントとコミットメッセージは英語で書き、既存の文体に合わせる。
