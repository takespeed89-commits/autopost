# 毎週の投稿づくり（Claude が読む手順）

毎週日曜の夜に、翌週（月〜日）の投稿を作って queue/ に入れる。人の確認は待たずに push してよい。
花田は queue/ のファイルを消せばその投稿を止められる。

## 1. 材料を集める
1. このリポジトリを最新にする（git pull）
2. `brands/confa.md` `brands/plugrig.md` `brands/round.md` `brands/rules.json` を読む
3. `posted/` の直近30日分を読み、同じ話題・同じ書き出しを繰り返さない。`result` に `failed` があれば、まとめの報告に書く
4. 製品の更新を見る：takespeed89-commits/confa・plugledger・round の直近7日のコミット（`git log --since="8 days ago" --oneline`）。利用者に見える変更だけを「機能を足した」ネタにする。内部の修正・セキュリティの話は書かない
5. 必要なら confa.jp / plugrig.app を開いて、書く事実が今も正しいか確かめる

## 2. 本数と時刻（日本時間）
| アカウント | X | Instagram |
| --- | --- | --- |
| confa | なし（カンファの X は当面作らない。2026-11-20） | 月・水・金 20:30（カルーセル 3〜5枚） |
| plugrig | 毎日 20:30（うち英語を週2本） | なし（PlugRig は X だけ） |
| round | なし（X はない） | 火・木 12:10（カルーセル 4〜5枚。院長向け） |

- 投稿は GitHub Actions が 7:40 / 12:10 / 20:30 に動くときに出る。at はこの3つのどれかにする
- X でURLを入れる投稿は、1アカウント週1本まで（1本0.2ドルかかる。ほかは0.015ドル）。URLのない投稿では「プロフィールのリンクから」と書く
- X に画像を付けるのは週2本まで（カンファは Instagram と同じ画像を使ってよい。PlugRig は X 用に画像を作る）
- ラウンドは事実を brands/round.md（原本は round リポジトリの docs/site-copy.md）からだけ取る。金額は税別・税込を併記

## 3. ファイルの形
`queue/<YYYYMMDD>-<HHMM>-<account>.json`

```json
{
  "account": "confa",
  "at": "2026-11-23T20:30:00+09:00",
  "theme": "出品できるもの",
  "x": { "text": "本文", "images": ["media/20261123-confa-1.jpg"] },
  "instagram": { "caption": "キャプション", "images": ["media/20261123-confa-1.jpg", "media/20261123-confa-2.jpg"] }
}
```
- x と instagram はどちらか片方だけでもよい。同じ時刻に両方出すなら1ファイルにまとめる
- theme は短いメモ（重複チェック用）

## 4. 画像
- `python3 scripts/render_card.py <spec.json>` で作る（spec の書き方はスクリプトの先頭）。spec は /tmp に置き、リポジトリには入れない
- 1枚目は cover、間に point / list、最後は end（サービス名と一言）
- 画像の文字は短く。1枚に言いたいことは1つ。改行位置は \n で指定してよい
- 作ったら Read で全部の画像を見て、はみ出し・変な改行・誤字がないか確かめる

## 5. 仕上げ
1. `node scripts/validate.mjs` が OK になるまで直す
2. 自分で読み直す：事実は brands/*.md にあることだけか／煽っていないか／同じ言い回しが続いていないか
3. コミットして push（メッセージ例「翌週の投稿 11/23〜11/29」）
4. 花田に短く報告：本数、テーマの一覧、止めたいときはファイルを消せばよいこと、失敗があればその内容
