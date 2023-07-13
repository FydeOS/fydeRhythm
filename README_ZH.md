# 真文韵输入法

<h4 align="right"><strong>  <a href="https://github.com/FydeOS/fydeRhythm"> English</strong></a> | 简体中文</h4>
<p align="center">
    <img src=https://github.com/Lorde627/fydeRhythm/blob/master/fydeRhythm%20Logo.png?raw=true width=138/>
</p>
<p align="center">
    <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://img.shields.io/badge/%20-Chrome-red?logo=google-chrome&logoColor=white" alt="Download for Chrome" />
  </a>
    
**真文韵输入法**是FydeOS团队倾心打造的一款专为 ChromeOS 和 FydeOS 操作系统量身定制的输入法，其基础建立在功能卓越、高度可定制的 [RIME](https://rime.im/) 输入法引擎上。

我们在此处展示的是第二代真文韵输入法的源代码。与第一代相比，第二代真文韵输入法引入了全新的设计理念和架构，将所有输入法组件，包括 RIME 引擎，全都封装在插件中，从而无需在系统中运行单独的服务器。我们借助 emscripten 工具链，将 RIME 引擎成功编译到 WebAssembly 中，使其能够直接在插件环境中运行。同时，我们对存储内容和启动流程进行了优化，确保启动更快捷，用户体验更加流畅。

## 特性一览
- 🌍 **多语种输入模式**：支持拼音、双拼、简繁中文输入，同时也支持韩语和日语输入。
- 🎛️ **高度自定义**：用户可自定义模糊音和候选词数量，提供更具个性化的输入体验。
- 📊 **智能排序**：根据用户的使用频率，自动调整候选词的显示顺序，使得输入更为便捷。
- 🧠 **个性化用户词库**：根据用户的历史输入数据，生成个性化的用户词库，进一步提升输入速度和效率。
- 📚 **丰富词库**：内置主流的中文输入法标准词库和网络常用词，增强了输入体验。
- 🛠️ **配置文件修改权限**：提供配置文件修改权限，让你可以根据自身的需要自由调整输入法的设置。

## 下载
- [![Chrome 商店](https://img.shields.io/badge/%20-Chrome-red?logo=google-chrome&logoColor=white)](https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni) 
- [GitHub Release](https://github.com/FydeOS/fydeRhythm)

## 更多信息
如果你对我们的项目感兴趣，并希望了解更多关于本项目的信息，如构建流程、内部结构等，欢迎访问我们的 [Wiki](https://github.com/FydeOS/fydeRhythm/wiki) 页面。
