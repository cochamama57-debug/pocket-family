> 2026-11-07 に、Claude Code の Claude Security プラグイン（claude-security@claude-plugins-official）でリポジトリ全体を点検した結果です。見つかった2件（F1・F2）は、同じ日に直しました（F1：おしゃべりに端末ごと・全体の1日の上限、F2：手元の試しサーバーが止まらないように）。

# Claude Security results

`pocket-family` のリポジトリ全体（コミット `6379f8d`、範囲指定なし）を、2026-11-07（UTC 03:14開始）に medium の深さで点検しました。確かめを通った問題は **2件**：MEDIUM 1件、LOW 1件です。CRITICAL・HIGH はありません。点検したとき、作業中のフォルダにはまだコミットしていない変更や、記録していないファイルがありました。

## Coverage

対象は git が記録しているファイル96個。4つのまとまりに分けて読みました：

- **api-line-help**：`api/line-webhook.js`、`api/help.js`、`api/family.js`、`api/cron-quiet.js`、`api/health.js`、`lib/line.js`、`lib/store.js`
- **api-ai-voice**：`api/chat.js`、`api/diary.js`、`api/drawing.js`、`api/memory.js`、`api/voice.js`、`api/yt-search.js`、`api/ics.js`、`lib/shared.js`
- **web-frontend**：`public/index.html`、`public/manifest.webmanifest`、`public/songs/songs.json`
- **dev-scripts**：`scripts/`

わざと読まなかった所：**static-media-assets**（`public/chars`、`public/events`、`public/puzzle`、`public/songs/*.mp3`、アイコンのPNG、`public/line-qr.png`）。理由は「実行される処理のない、画像と音声のファイル」だからです。

最上位のフォルダ（`api`、`lib`、`public`、`scripts`）はすべて、読んだ所か、わざと外した所のどちらかに入っています。リポジトリ全体に抜けはありません。大きさの見積もり：記録されているファイル96個から、1つ約25ファイルのまとまりを4つ求め（上限24）、4つそのまま使いました。調べる人は13人送り出し、13人とも戻ってきました。調べ方は、4つのまとまりそれぞれについて「入力の扱いと注入」「認証とアクセス制御」「暗号と秘密」の3つ、それに加えて、どのまとまりにも入らないファイルを全種類の問題について読むもう1人です。どのまとまりも言語だけで判断して、調べる人に指示を出す前に「メモリ安全性」の見方を外しました。コードがすべてメモリ管理つきの言語だと見なしたためです。つまり、4つのまとまりのどの調べる人にも、メモリ安全性のバグは聞いていません。

まとまりの中の26ファイルは、全部最後まで読まれました。読み残し・行方不明はありません。まとまりの外の70ファイルは、上の外した素材と、ルート直下のファイルです。調べる人たちが「担当外なので、全体は読んでいない」と申告したもの：`public/index.html`（api の担当者は必要な所だけ検索）、dev-scripts の担当者が背景として見た `api/` の各ファイル、web-frontend の担当者が開かなかった `api/diary.js`。どのファイルも、それぞれの担当のまとまりの中では最後まで読まれています。

確かめ役の審査は1回で終わりました。確かめられずに残った問題はありません。

## Findings

### F1 — /api/chat が、端末や利用者の確認なしで有料の Anthropic API を呼んでいる (MEDIUM, confidence high)

**Impact.** だれでも、運営者のお金で Claude の API を使えてしまいます。予算を使い切られると、全員のおしゃべりが止まります。おしゃべりの中の「緊急」の言葉の見分けも止まります。長押しの「助けて」は `api/help.js` を通るので、おしゃべりが止まっても動きます。情報が盗まれたり書きかえられたりはしないので、HIGH ではなく MEDIUM です。

**Where.** `api/chat.js:166` の `handler` — CWE-306

**What.** だれでも `/api/chat` に POST を送れば、運営者の `ANTHROPIC_API_KEY` で `getClient().beta.messages.create` が呼ばれます。diary や drawing と違って、この入口は `dailyGate` を一度も呼びません。守りは2つだけです。1つは `fromOurPage` で、`Origin`／`Sec-Fetch-Site` のヘッダーが無ければ通ってしまいます。もう1つは、サーバーの各インスタンスのメモリの中で数える、IPごとに1分12回の `rateLimited` です。さらに、わざと「英語っぽい返事」を引き出せば、言い直しが起きて、1回のリクエストで有料の呼び出しが2回になります。

**Exploit scenario.** 攻撃する人は、`Content-Type: application/json` で `Origin` ヘッダーのない `POST /api/chat` を、スクリプトでくり返し送ります。1回ごとに、最大12,000字の会話（AIの返事を装ったものも入れられる）、ふくらませたプロフィール（メモ15個×80字）、2MBのJPEG、それに英語の返事を引き出して言い直しを起こさせる文を入れます。IPひとつで1分12回なら、一日中送り続けられます。IPを増やせば、その分だけ増えます。どのリクエストも運営者の Anthropic のアカウントに請求されます。

**Preconditions.**
- 本番で `ANTHROPIC_API_KEY` が設定されていること。

**Fix.** chat にも、ほかの入口と同じ端末の確認（`dailyGate`）を入れます。あわせて、Redis に、chat 全体の1日のリクエスト数またはトークン数の上限を持たせます。`fromOurPage` や、インスタンスごとのメモリでの回数制限を、アクセス制御の代わりにしないことです。補足：端末の登録はだれでも自分でできるので、端末の確認だけでは本当の認証にはなりません。上限を数える手段として効きます。

**Verification.** 3/3 の確かめ役が問題ありと判断しました。

### F2 — 開発用サーバーが、URLの道筋を普通のオブジェクトの鍵として引くため、`/api/__proto__` で例外が出てサーバーが止まる (LOW, confidence medium)

**Impact.** 手元の開発用サーバーだけが止まります（サービス妨害）。情報が盗まれたり書きかえられたりはしません。`npm run dev` を実行し直せば戻ります。本番（Vercel）には関係ありません。

**Where.** `scripts/dev.mjs:40` の `http.createServer` のリクエスト処理（名前のない async の関数） — CWE-248（ほかに CWE-346）

**What.** `apiName`（リクエストURLの `url.pathname.slice(5)`）は攻撃する人が自由に決められます。守りは17行目の `handlers[apiName]` があるかどうかの確認だけで、`handlers` は普通のオブジェクトなので、`__proto__`・`constructor`・`toString` のような、もとから受けついでいる鍵も通ってしまいます。40行目でそれを関数として呼ぶと、`__proto__` の場合は `Object.prototype` が呼べないので TypeError になります。だれも受け止めないので、Node 20 以降（package.json の指定）ではプロセスごと終わります。`toString` などでは返事を書かないので、接続がつながったまま残ります。33行目には似た問題がもう1つあり、`PF_MOCK` を設定していると、受け取った本文の `JSON.parse` に try/catch がなく、JSONでない本文でも同じように落ちます。もう1点（CWE-346）：開発用サーバーは Host が localhost かどうかを確かめません。また、`fromOurPage`（`lib/shared.js:166-178`）は Origin を Host ヘッダーと比べるので、DNSリバインディングでは両方を攻撃する人が決められて、確認を通ってしまいます。プロセスが終わることは、Node の決まった動きから考えたもので、実際にサーバーを動かして確かめてはいません。

**Exploit scenario.** 開発する人が `npm run dev` を動かしている間に、同じパソコンの別のプログラムか、外部ページから手元へのアクセスを止めないブラウザで開いたページが、`POST http://127.0.0.1:3000/api/__proto__` を送ります（no-cors の fetch で十分です。サーバーがメソッドを確かめないので、OPTIONS のプリフライトでも40行目まで届きます）。処理が例外を出し、だれも受け止めないまま、Node のプロセスが終わります。

**Preconditions.**
- 開発する人が手元で開発用サーバー（`scripts/dev.mjs`）を動かしていること。本番に置くことはない。
- 攻撃する人が `127.0.0.1:PORT` に届くこと。同じパソコンのプログラムか、外部ページから手元へのアクセスを止めないブラウザ（ChromeのLocal/Private Network Accessは止めることがある。Safariは止めないことがある）。

**Fix.** 自分で持っている鍵だけを引くようにします（`Object.hasOwn(handlers, apiName)`、または `Map`／`Object.create(null)` で作る）。リクエスト処理の中身を try/catch で包んで、例外が出ても500を返すようにします。33行目の `JSON.parse` も try/catch で包みます。CWE-346 について：Host が `localhost:PORT`／`127.0.0.1:PORT`／`[::1]:PORT` でないリクエストは断ります。`fromOurPage` は、Host と比べるのをやめて、決めておいた Origin の一覧と比べるようにします。

**Verification.** 2/3 の確かめ役が問題ありと判断しました。

## What was verified

最初にリポジトリを4つのまとまりに分けて、危険の見立てを作りました。それから、まとまりごと・種類ごとに調べる人12人と、まとまりに入らないファイルを読む1人を送り出しました（13人とも戻りました）。問題の候補は9件で、重なりをまとめて8件になり、それぞれを3つの見方（届くかどうか・どれだけの被害か・守りがあるか）の確かめ役が審査しました（合計24票）。3人中2人以上が「問題あり」とした候補だけが残りました。F1 は 3/3、F2 は 2/3 です。ほかの6件は審査で外れました。報告書のスタンプの verification.status は、報告書を作る仕組みが票の記録から出したもので、報告書をまとめるときに書かれます。この点検ではリポジトリのコードは一度も動かしていません。テストも、攻撃の試しも、確認用のコード（PoC）の実行もしていません。どの問題も、コードを読んで見つけたものです。
