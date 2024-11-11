# 真文韻輸入法

<h4 align="right">
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README.md">English</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-ZH_CN.md">简体中文</a> | 
  <strong>繁體中文</strong> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-JA.md">日本語</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-KO.md">한국인</a>
</h4>

<p align="center"><img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/fyderhythm_logo.png" width=138/></p>

<p align="center">
    <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/chromewebstore.png"raw=true width=138 alt="Download for Chrome" /></a>
</p>


**真文韻輸入法**是 FydeOS 團隊精心研發的一款輸入法產品，專為 ChromeOS 與 FydeOS 操作系統量身打造，基於功能強大且高度可自訂的 [RIME](https://rime.im/) 輸入法引擎。


<p align="center">
<a >
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/fyderhythm_demo.gif" alt="fydeRhythm Demo" width="500">
</a>
</p>


此專案為第二代「真文韻輸入法」。與第一代相比，第二代引入了全新的設計理念與架構，將所有輸入法組件，包括 RIME 引擎，皆封裝於擴充套件中，因此無需在系統中運行單獨的伺服器。我們透過 emscripten 工具鏈，成功將 RIME 引擎編譯至 WebAssembly，使其可直接在擴充套件環境中運行。同時，優化了儲存內容及啟動流程，確保啟動速度更快，使用體驗更為流暢。

## 功能概覽
- 🌍 **多語種輸入模式**：支援拼音、雙拼、簡繁中文輸入，並且支援韓文及日文輸入。
- 🎛️ **高度客製化**：用戶可自訂模糊音與候選詞數量，提供更具個人化的輸入體驗。
- 📊 **智慧排序**：根據用戶的使用頻率，自動調整候選詞的顯示順序，使輸入更為便捷。
- 🧠 **個人化用戶詞庫**：依據用戶的歷史輸入資料，生成個人化用戶詞庫，進一步提升輸入速度與效率。
- 📚 **豐富詞庫**：內建主流中文輸入法標準詞庫及網路常用詞，增強輸入體驗。
- 🛠️ **配置檔修改權限**：提供配置檔修改權限，讓你能根據需求自由調整輸入法設置。

## 下載
- <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/chromewebstore.png" alt="Chrome Web Store" width="138">
</a>

- [GitHub Release](https://github.com/FydeOS/fydeRhythm/releases)

## 更多資訊
若你對我們的專案感興趣，並希望了解更多關於此專案的資訊，例如建構流程、內部架構等，歡迎造訪我們的 [Wiki](https://github.com/FydeOS/fydeRhythm/wiki) 頁面。
