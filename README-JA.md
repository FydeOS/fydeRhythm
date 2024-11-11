# 真文韻入力法

<h4 align="right">
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README.md">English</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-ZH_CN.md">简体中文</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-ZH_TW.md">繁體中文</a> | 
  <strong>日本語</strong> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-KO.md">한국인</a>
</h4>

<p align="center"><img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/fyderhythm_logo.png" width=138/></p>

<p align="center">
    <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/chromewebstore.png"raw=true width=138 alt="Download for Chrome" /></a>
</p>


**真文韻入力法**は、FydeOS チームが精魂込めて開発した入力法であり、ChromeOS およびFydeOSオペレーティングシステム向けに特別設計されています。強力で高いカスタマイズ性を誇る [RIME](https://rime.im/) 入力エンジンをベースにしています。


<p align="center">
<a >
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/fyderhythm_demo.gif" alt="fydeRhythm Demo" width="500">
</a>
</p>


このプロジェクトは第二世代の「真文韻入力法」です。初代と比較して、第二世代では新しいデザインコンセプトとアーキテクチャを導入し、RIMEエンジンを含むすべての入力法コンポーネントを拡張機能に統合しました。そのため、システム内で個別のサーバーを実行する必要がありません。emscriptenツールチェーンを活用してRIMEエンジンをWebAssemblyにコンパイルし、拡張機能環境で直接実行できるようにしました。また、ストレージ内容と起動プロセスを最適化し、より迅速な起動とスムーズなユーザー体験を実現しました。

## 特徴一覧
- 🌍 **多言語入力モード**：ピンイン、双拼、簡体字・繁体字中国語入力に対応し、韓国語および日本語入力もサポート。
- 🎛️ **高度なカスタマイズ**：ユーザーは曖昧音や候補文字数を自由にカスタマイズでき、個性的な入力体験を提供。
- 📊 **インテリジェントなソート**：ユーザーの使用頻度に基づいて候補の表示順を自動調整し、より便利な入力を実現。
- 🧠 **パーソナライズされたユーザー辞書**：ユーザーの入力履歴に基づいてパーソナライズされた辞書を生成し、入力速度と効率をさらに向上。
- 📚 **豊富な辞書**：主要な中国語入力法の標準辞書とネット上でよく使用される単語を内蔵し、入力体験を強化。
- 🛠️ **設定ファイル編集権限**：設定ファイルを編集する権限を提供し、自分のニーズに応じて入力法の設定を自由に調整可能。

## ダウンロード
- <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/chromewebstore.png" alt="Chrome Web Store" width="138">
</a>

- [GitHub Release](https://github.com/FydeOS/fydeRhythm/releases)

## 詳細情報
このプロジェクトに興味があり、ビルドプロセスや内部構造など、さらに詳しい情報を知りたい場合は、ぜひ [Wiki](https://github.com/FydeOS/fydeRhythm/wiki) ページをご覧ください。