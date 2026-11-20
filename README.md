# autopost — カンファ・PlugRig・ラウンドの自動投稿

X と Instagram に、予約した投稿を自動で出す仕組み。文章と画像は Claude が毎週書く。

## 仕組み
1. 毎週日曜の夜、Claude の定期タスクが翌週分の投稿を書いて `queue/` に入れ、画像を `media/` に置いて push する（手順は `WRITING.md`）
2. GitHub Actions（`.github/workflows/post.yml`）が毎日 7:40 / 12:10 / 20:30 に動き、時刻が来た投稿を出す
3. 出したものは `posted/` に移る（X・Instagram の投稿IDつき）

## 投稿を止めたいとき
- 1本だけ止める：`queue/` のそのファイルを消す（GitHub のアプリからでも消せる）
- アカウントごと止める：`accounts.json` の `enabled` を `false` にする
- 全部止める：GitHub の Actions 画面で「予約投稿」を Disable にする

## 本数と費用の目安
| | X | Instagram |
| --- | --- | --- |
| カンファ | 毎日 12:10 | 月・水・金 20:30 |
| PlugRig | 毎日 20:30 | なし（X だけ） |
| ラウンド | なし | 火・木 12:10 |

- X の API は従量課金：投稿1本 0.015ドル、URL入りは 0.2ドル、画像のアップロード 0.005ドル。URL入りは各アカウント週1本までにしているので、2アカウントで月 2〜3ドル程度
- Instagram の API は無料。GitHub Actions は公開リポジトリなら無料

## 初期設定（一度だけ）

### 1. GitHub の Secrets（リポジトリの Settings → Secrets and variables → Actions）
| 名前 | 中身 |
| --- | --- |
| `CONFA_X_API_KEY` `CONFA_X_API_SECRET` `CONFA_X_ACCESS_TOKEN` `CONFA_X_ACCESS_SECRET` | カンファの X の鍵4つ |
| `PLUGRIG_X_API_KEY` `PLUGRIG_X_API_SECRET` `PLUGRIG_X_ACCESS_TOKEN` `PLUGRIG_X_ACCESS_SECRET` | PlugRig の X の鍵4つ |
| `CONFA_IG_ACCESS_TOKEN` | カンファの Instagram の鍵（システムユーザーのアクセストークン。期限なし） |
| `CONFA_IG_USER_ID` | カンファの Instagram アカウントのID（数字） |

鍵がまだないアカウントは、投稿せずに `posted/` へ「no-key」として流れる（あとで溜まった分が一気に出ることはない）。

### 2. X の鍵（アカウントごと）
1. 投稿したいアカウントでログインした状態で、X の Developer Console を開いてアプリを作る
2. アプリの認証設定で権限を「Read and write」にする
3. 「Keys and tokens」で API Key・API Secret と、Access Token・Access Token Secret を作る（権限を変えたあとに作り直す）
4. クレジットを入れる（支払いの上限＝Spending limit も設定しておく）

### 3. Instagram の鍵（カンファ）
Meta の新しいアプリは「ビジネス向け Facebook ログイン（統合ログイン）」で、鍵はシステムユーザーのアクセストークン（期限なし）になる。
1. Instagram アプリでアカウントを「プロアカウント（ビジネス）」に切り替える
2. Meta for Developers のアプリ「Backroom Autopost」（ビジネスポートフォリオ Backroom Studio にひも付け済み）
3. ビジネス設定 → Instagram プロフィール →「追加」でカンファの Instagram を追加
4. ビジネス設定 → システムユーザーで管理者のシステムユーザーを作り、カンファの Instagram とアプリを割り当てて、`instagram_basic` と `instagram_content_publish` のトークンを作る
5. トークンを `CONFA_IG_ACCESS_TOKEN`、Instagram アカウントのIDを `CONFA_IG_USER_ID` に入れる

ラウンド（@round.confa）もシステムユーザー autopost に割り当ててあり、同じ鍵（CONFA_IG_ACCESS_TOKEN）で投稿する。アカウントIDは accounts.json の userId。

### 4. 試しに動かす
Actions →「予約投稿」→ Run workflow（「試しに動かす」にチェック）。何が投稿されるかが記録に出る。

## ファイル
- `queue/` 予約中の投稿　`posted/` 出した投稿　`media/` 画像
- `brands/confa.md` `brands/plugrig.md` `brands/round.md` 書き方の決まり　`brands/rules.json` 機械で止める言葉
- `scripts/post.mjs` 投稿　`scripts/validate.mjs` 検査　`scripts/render_card.py` 画像づくり
