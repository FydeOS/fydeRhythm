# fydeRhythm（真文韵输入法）
<h4 align="right">
  <strong>English</strong> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-ZH_CN.md">简体中文</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-ZH_TW.md">繁體中文</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-JA.md">日本語</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-KO.md">한국인</a>
</h4>

<p align="center"><img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/fyderhythm_logo.png" width=138/></p>


<p align="center">
    <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/chromewebstore.png"raw=true width=138 alt="Download for Chrome" /></a>
</p>


**fydeRhythm** is a meticulously crafted keyboard input method editor(IME), designed by the FydeOS team. fydeRhythm is designed for operating systems that are based on the Chromium OS ecosystem, such as chromeOS, openFyde and FydeOS. It leverages the power and versatility of the [RIME](https://rime.im/) input method engine.


<p align="center">
<a >
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/fyderhythm_demo.gif" alt="fydeRhythm Demo" width="500">
</a>
</p>

We're proud to present the source code for the second iteration of fydeRhythm. This version marks a departure from the first, bringing a fresh design paradigm and architectural approach. Every component of the input method, inclusive of the RIME engine, is encapsulated within the plugin, thus eliminating the need for an independent server running within the system. We've successfully compiled the RIME engine into WebAssembly, courtesy of the emscripten toolchain, facilitating its execution directly within the plugin environment. Additionally, optimizations have been applied to the storage content and startup process to ensure swift launches and an enhanced user experience.

## Features
- 🌍 **Multi-language Input**: Accommodates Pinyin, double Pinyin, simplified and traditional Chinese, along with Korean and Japanese input.
- 🎛️ **Customisability**: Offers customization of fuzzy tones and the number of candidate words, enabling a more personalized input experience.
- 📊 **Intelligent Prioritisation**: Auto-adjusts the display order of candidate words based on the user's usage patterns, streamlining the input process.
- 🧠 **Custom User Dictionary**: Creates a unique user dictionary built on the user's past input data, which bolsters input speed and efficiency.
- 📚 **Comprehensive Dictionary**: Incorporates a built-in mainstream standard Chinese input method dictionary and common internet terms, enriching the input experience.
- 🛠️ **Configurable Settings**: Grants users the freedom to modify configuration files, offering flexibility in adjusting the input method settings to their needs.

## Download Options
- <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/chromewebstore.png" alt="Chrome Web Store" width="138">
</a>

- [GitHub Release](https://github.com/FydeOS/fydeRhythm/releases)

## Discover More
If you're interested in our project and want to learn more about it, such as the build process, internal structure, etc., please visit our [Wiki](https://github.com/FydeOS/fydeRhythm/wiki) page.
