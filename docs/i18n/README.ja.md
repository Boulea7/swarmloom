<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/hero-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="../../assets/brand/hero-light.svg" />
    <img alt="SwarmLoom：カーソルの群れが織り上げる様子を眺める" src="../../assets/brand/hero-light.svg" width="1280" />
  </picture>
</p>

<h1 align="center">SwarmLoom</h1>

<p align="center"><strong>カーソルの群れが、あなたの目の前で織り上げる。</strong><br/>Web ページ、ドキュメント、コード、画像、3D モデルを、カーソルの群れが目の前で少しずつ組み立て、音声付きの動画として書き出せます。<br/>これはローカルで動く視覚的なリプレイであり、AI エージェントのオーケストレーターではありません。</p>

<p align="center">
  <a href="https://github.com/Boulea7/swarmloom/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Boulea7/swarmloom/ci.yml?branch=main&amp;style=flat-square&amp;label=CI" /></a>
  <a href="../../LICENSE"><img alt="MIT ライセンス" src="https://img.shields.io/badge/license-MIT-5B5BF7?style=flat-square" /></a>
  <a href="../../CONTRIBUTING.en.md"><img alt="PR 歓迎" src="https://img.shields.io/badge/PRs-welcome-5B5BF7?style=flat-square" /></a>
</p>

<p align="center"><a href="../../README.md">简体中文</a> · <a href="../../README.en.md">English</a> · <a href="./README.zh-TW.md">繁體中文</a> · <strong>日本語</strong> · <a href="./README.ko.md">한국어</a> · <a href="./README.es.md">Español</a> · <a href="./README.fr.md">Français</a> · <a href="./README.de.md">Deutsch</a></p>

<p align="center">
  <a href="https://boulea7.github.io/swarmloom/studio/"><strong>Studio をオンラインで試す</strong></a> ·
  <a href="https://boulea7.github.io/swarmloom/"><strong>ウェブサイト</strong></a> ·
  <a href="https://boulea7.github.io/swarmloom/docs/en/"><strong>ドキュメント</strong></a>
</p>

## 紹介動画

<!-- VIDEO:main -->

メイン動画は現在制作中です。完成後、ここで再生できます。

<!-- /VIDEO:main -->

インストール不要で、同じサンプルを[オンライン Studio](https://boulea7.github.io/swarmloom/studio/)で開けます。先に[図解ガイド](https://boulea7.github.io/swarmloom/docs/en/getting-started.html)を読むこともできます。

## 対応フォーマット

以下のアニメーションはすべて、SwarmLoom が実際にレンダリングしたものです。選択すると、同じサンプルを Studio で再生できます。

<table>
  <tr>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=web-demo"><img alt="カーソルの群れが Web ページを再構築" src="../../docs/assets/formats/web.webp" width="100%" /></a><br/>Web ページ</td>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=html-landing"><img alt="HTML ページをブロックごとに組み立て" src="../../docs/assets/formats/html.webp" width="100%" /></a><br/>HTML</td>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=svg-emblem"><img alt="SVG パスを一筆ずつ描画" src="../../docs/assets/formats/svg.webp" width="100%" /></a><br/>SVG</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=markdown-welcome.en"><img alt="Markdown の見出しと本文を再構築" src="../../docs/assets/formats/markdown.webp" width="100%" /></a><br/>Markdown</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=docx-report"><img alt="Word 文書を再構築" src="../../docs/assets/formats/docx.webp" width="100%" /></a><br/>DOCX</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=doc-report"><img alt="旧形式の Word 文書を再構築" src="../../docs/assets/formats/doc.webp" width="100%" /></a><br/>DOC</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=pdf-brochure"><img alt="PDF ページを再構築" src="../../docs/assets/formats/pdf.webp" width="100%" /></a><br/>PDF</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=slides-pitch"><img alt="スライドを再構築" src="../../docs/assets/formats/slides.webp" width="100%" /></a><br/>スライド</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=sheet-sales"><img alt="スプレッドシートを行ごとに組み立て" src="../../docs/assets/formats/sheet.webp" width="100%" /></a><br/>スプレッドシート</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=code-swarm"><img alt="ソースコードをトークンごとに入力" src="../../docs/assets/formats/code.webp" width="100%" /></a><br/>コード</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=image-scene"><img alt="画像の輪郭を描いてから着色" src="../../docs/assets/formats/image.webp" width="100%" /></a><br/>画像</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=3d-shuttle-glb"><img alt="3D モデルのメッシュとマテリアルを組み立て" src="../../docs/assets/formats/three.webp" width="100%" /></a><br/>3D モデル</td>
  </tr>
</table>

<details>
<summary>その他の対応フォーマット</summary>

OpenDocument（ODT / ODS / ODP）、EPUB、RTF、OFD、Jupyter Notebook、asciinema のターミナル録画、Patch / Diff、XMind / FreeMind のマインドマップ、Lottie アニメーションに対応しています。スプレッドシートは XLSX / CSV / ODS、3D は GLB / glTF / OBJ / STL / PLY をサポートします。各拡張子と再現度の詳細は[フォーマットガイド](https://boulea7.github.io/swarmloom/docs/en/formats.html)をご覧ください。

</details>

## SwarmLoom を選ぶ理由

<table>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/web-dark.svg" /><img alt="Web ページのカード" src="../../assets/brand/cards/web-light.svg" width="100%" /></picture><br/><b>今開いているページを再構築</b><br/>拡張機能が現在のタブまたは選択した領域を再構築し、終了後は元のページをそのまま残します。</td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/docs-dark.svg" /><img alt="ドキュメントのカード" src="../../assets/brand/cards/docs-light.svg" width="100%" /></picture><br/><b>多彩なフォーマットを、ひとつのステージで</b><br/>ドキュメント、スプレッドシート、スライド、コード、画像、3D を、同じカーソルの群れが組み立てます。</td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/video-dark.svg" /><img alt="動画書き出しのカード" src="../../assets/brand/cards/video-light.svg" width="100%" /></picture><br/><b>音声付き動画を書き出し</b><br/>CLI は MP4、WebM、GIF をフレームごとに書き出します。同じ設定なら、映像も音声も同じ結果になります。</td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/platforms-dark.svg" /><img alt="プラットフォームのカード" src="../../assets/brand/cards/platforms-light.svg" width="100%" /></picture><br/><b>マルチプラットフォーム</b><br/>Chrome、Edge、Firefox、Safari の拡張機能に加え、PWA 版 Studio と、スマートウォッチ向けの小型プレーヤーを用意しています。</td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/html-svg-dark.svg" /><img alt="HTML と SVG アニメーションのカード" src="../../assets/brand/cards/html-svg-light.svg" width="100%" /></picture><br/><b>アニメーションも引き継ぐ</b><br/>SVG アニメーションは描画の構築が完了すると再生を始め、「Go live」を選択すると CSS アニメーションも再開します。</td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/code-dark.svg" /><img alt="コードのカード" src="../../assets/brand/cards/code-light.svg" width="100%" /></picture><br/><b>埋め込みも、スクリプト連携も</b><br/><code>&lt;swarm-loom&gt;</code> 要素、JavaScript API、CLI を利用できます。</td>
  </tr>
</table>

## 仕組み

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/how-it-works-dark.svg" />
    <img alt="Web ページやファイルを読み込み、読む順序でカーソルを配置し、ライブ再生または動画として書き出す" src="../../docs/assets/how-it-works-light.svg" width="760" />
  </picture>
</p>

SwarmLoom は Web ページやファイルをレイヤーに分割し、読む順序に沿ってカーソルに割り当てます。Studio では構築の様子をライブで再生し、CLI では 1 フレームずつキャプチャして音声を合成します。そのため、書き出し結果はマシンの処理速度に左右されません。

## クイックスタート

### オンラインで試す

[オンライン Studio](https://boulea7.github.io/swarmloom/studio/)を開き、サンプルを選ぶか、ローカルファイルをドロップ、テキストを貼り付け、URL を入力してください。ローカルファイルはブラウザ内に保持されます。URL の場合はブラウザがそのサイトに直接アクセスするため、サイト側でクロスオリジンの読み取りが許可されている必要があります。

### ソースからビルド

GitHub Releases、npm パッケージ、ストアでの公開は今後予定しています。現時点ではソースからビルドしてください。Node.js 22.12 以降が必要で、pnpm のバージョンは `packageManager` に固定されています。

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
pnpm install
pnpm build
```

### CLI

リポジトリのルートで、ファイルを動画に変換します：

```bash
node apps/cli/dist/cli.js render examples/svg/emblem.svg -o emblem.mp4
```

Chrome または Chromium が必要です。MP4、WebM、GIF、WebP の書き出しには FFmpeg 4 以降も必要です。`node apps/cli/dist/cli.js doctor` を実行して環境を確認できます。npm パッケージ公開後は、`npx swarmloom` を直接実行できるようになる予定です。

### Web Component

npm パッケージ `@swarmloom/element` はまだ公開されていません（公開予定）。コンポーネント自体は動作します：

```html
<script type="module">
  import { define } from "@swarmloom/element";
  define();
</script>

<swarm-loom
  src="./demo.md"
  type="markdown"
  agents="24"
  seed="7"
  autoplay
  controls>
</swarm-loom>
```

すべての属性とイベントについては、[コンポーネントガイド](https://boulea7.github.io/swarmloom/docs/en/element.html)をご覧ください。

## プラットフォーム別のインストール

ストア版と署名付きパッケージはまだ公開されていません。以下の手順ではすべて、前の手順で `pnpm build` が生成した開発用パッケージを使用します。

<details>
<summary>Chrome / Edge / Brave / Opera</summary>

- Chrome：`chrome://extensions` を開き、デベロッパーモードをオンにして「パッケージ化されていない拡張機能を読み込む」を選び、`apps/extension/dist/chrome/` を選択します。
- Edge：`edge://extensions` を開き、`apps/extension/dist/edge/` を選択します。
- Brave / Opera：それぞれの拡張機能ページでデベロッパーモードをオンにし、同じ `dist/chrome/` を選択します。
- 通常の Web ページでは、ツールバーのアイコンを選択するか、Alt+Shift+W を押します。ブラウザの内部ページ、ウェブストア、内蔵 PDF ビューアでは拡張機能を実行できません。

</details>

<details>
<summary>Firefox デスクトップ版・Android 版（署名付きリリースは公開予定）</summary>

デスクトップ版：`about:debugging#/runtime/this-firefox` を開き、「一時的なアドオンを読み込む」を選択して `apps/extension/dist/firefox/manifest.json` を選びます。Firefox を再起動すると削除されます。Android 版も同じパッケージを使用しますが、デバッグには web-ext、ADB、デバッグを有効にしたデバイスが必要です。継続してインストールするには AMO 署名付きリリースが必要です。それまでは、スマートフォンでは PWA 版 Studio をご利用ください。

</details>

<details>
<summary>Safari macOS / iOS / iPadOS / visionOS（実機テストと署名は実施予定）</summary>

Xcode をインストールした Mac で `pnpm --filter @swarmloom/extension package:safari` を実行し、Xcode で `apps/extension/build/safari/` を開きます。チームを選択してコンテナアプリを実行したら、システム設定で拡張機能を有効にしてください。デバイスへのインストールには Apple Developer Program が必要です。これらの OS での実機テストはまだ完了していません。

</details>

<details>
<summary>PWA：デスクトップ、Android、iOS / iPadOS</summary>

Chrome / Edge では Studio を開き、アドレスバーまたはメニューの「アプリをインストール」を使用します。macOS の Safari では「Dock に追加」、Android では「アプリをインストール」または「ホーム画面に追加」、iOS / iPadOS では Safari の共有メニューから「ホーム画面に追加」を選択します。Firefox デスクトップ版では、通常のタブで Studio をご利用ください。

</details>

<details>
<summary>折りたたみデバイスとスマートウォッチ</summary>

折りたたみデバイスに追加のインストールは不要です。ブラウザが Viewport Segments に対応していれば、Studio は左右または上下の 2 ペインに分割され、未対応の場合は通常のレイアウトになります。スマートウォッチ向けの拡張機能はなく、完全な PWA も保証しません。`?watch=1` を開くとミュート状態で始まる小型プレーヤー、`?round=1` では円形ディスプレイ向けの表示になります。大きなシーンは別のデバイスで書き出してからご覧ください。

</details>

## Swarm Rebuild との比較

| 項目 | SwarmLoom の追加要素 |
| --- | --- |
| 入力 | 現在の Web ページだけでなく、ドキュメント、コード、画像、3D モデルにも対応。 |
| プラットフォーム | Chrome 拡張機能だけでなく、Studio PWA、CLI、Web Component、スマートウォッチ用プレーヤーを利用可能。 |
| 出力 | 音声付き動画を書き出せます。同じ設定なら、同じ結果が得られます。 |

## ドキュメント

[スタートガイド](https://boulea7.github.io/swarmloom/docs/en/getting-started.html) · [フォーマットと制限](https://boulea7.github.io/swarmloom/docs/en/formats.html) · [プラットフォーム別インストール](https://boulea7.github.io/swarmloom/docs/en/install.html) · [CLI](https://boulea7.github.io/swarmloom/docs/en/cli.html) · [Web Component](https://boulea7.github.io/swarmloom/docs/en/element.html) · [プライバシー](../../PRIVACY.md)

## よくある質問

1. **カーソルを動かしているのは AI ですか？** いいえ。カーソルは固定のシードで制御される、ローカルのアニメーションです。モデルは一切呼び出さず、ドキュメントや HTML 内のスクリプトも実行されません。
2. **ローカルファイルはアップロードされますか？** いいえ。ファイルはブラウザ内で処理されます。URL を開いたときだけ、ブラウザがそのサイトにアクセスします。HTML が参照する画像やフォントの読み込みは、Studio の設定で無効にできます。詳しくは[プライバシー](../../PRIVACY.md)をご覧ください。
3. **一部のページをその場で再構築できないのはなぜですか？** ブラウザの内部ページ、ウェブストア、内蔵 PDF ビューアでは、拡張機能の実行が許可されていません。その場合は、ファイルを Studio にドロップしてください。ログインが必要な通常の Web ページでは、拡張機能をご利用ください。
4. **同じ設定なら、MP4 もバイト単位で完全に一致しますか？** 入力、ブラウザ、フォント、OS、設定が同じであれば、映像と音声はフレーム単位で一致します。ただし、エンコーダーのバージョンが異なると、MP4 ファイル自体のバイト列は一致しないことがあります。
5. **スマートフォンやスマートウォッチに拡張機能をインストールできますか？** スマートフォンでは、現時点では PWA 版 Studio をご利用ください。署名付きの Firefox Android 版は公開予定です。スマートウォッチでは小型プレーヤーのみ利用でき、拡張機能とバックグラウンド再生には対応していません。

## ロードマップ

- **現在**：オンライン Studio、Web ページと 20 種類のファイルフォーマット、CLI または Studio 内でのフレーム単位の動画書き出し、ソースからビルドできる Chrome / Edge / Firefox / Safari 拡張機能。
- **次に**：初の GitHub Release と npm パッケージ、ストアでの公開と署名付き拡張機能、スマートフォンと Safari 搭載デバイスでのテスト。
- **今後**：対応フォーマットとプラットフォームの拡充。公開時期は未定です。[Ideas](https://github.com/Boulea7/swarmloom/discussions/categories/ideas) でアイデアをお寄せください。

## 貢献とサポート

- コード、ドキュメント、翻訳、サンプル：まず [CONTRIBUTING](../../CONTRIBUTING.en.md) と[行動規範](../../CODE_OF_CONDUCT.md)をお読みください。
- 使い方に関する質問：[Discussions Q&A](https://github.com/Boulea7/swarmloom/discussions/categories/q-a)。再現可能な不具合：[Bug Report](https://github.com/Boulea7/swarmloom/issues/new?template=bug_report.yml)。
- 対応してほしいフォーマット：[Format Request](https://github.com/Boulea7/swarmloom/issues/new?template=format_request.yml)。
- セキュリティ上の問題：[SECURITY](../../SECURITY.md) の案内に従って非公開で報告してください。公開 Issue には投稿しないでください。

## 謝辞

Joel Califa 氏の Swarm と Dhvanil Patel 氏の Swarm Rebuild から着想を得ました。SwarmLoom は独立したクリーンルーム実装であり、これらのプロジェクトのコード、定数テーブル、ビジュアルアセットは一切再利用していません。また、両プロジェクトとの提携関係もありません。カーソル、配色、アイコン、音声、コードはオリジナル、またはライセンスが明確なものです。詳しくは[サードパーティクレジット](https://boulea7.github.io/swarmloom/docs/en/credits.html)をご覧ください。

プロモーション動画で指揮者として登場する Clawd は、Claude Code のマスコットをファンがアレンジしたもので、Anthropic との関係はありません。

## ライセンス

[MIT](../../LICENSE) © 2026 Boulea7 および SwarmLoom のコントリビューター
