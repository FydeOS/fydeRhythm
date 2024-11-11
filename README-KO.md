# 진문운 입력법

<h4 align="right">
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README.md">English</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-ZH_CN.md">简体中文</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-ZH_TW.md">繁體中文</a> | 
  <a href="https://github.com/FydeOS/fydeRhythm/blob/master/README-JA.md">日本語</a> | 
  <strong>한국인</strong>
</h4>

<p align="center"><img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/fyderhythm_logo.png" width=138/></p>

<p align="center">
    <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/chromewebstore.png"raw=true width=138 alt="Download for Chrome" /></a>
</p>


**진문운 입력법** 는 FydeOS 팀이 심혈을 기울여 개발한 입력기로, ChromeOS 및 FydeOS 운영 체제에 최적화된 특별한 설계를 가지고 있습니다. 강력하고 높은 커스터마이징 가능성을 자랑하는 [RIME](https://rime.im/) 입력 엔진을 기반으로 하고 있습니다.


<p align="center">
<a >
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/fyderhythm_demo.gif" alt="fydeRhythm Demo" width="500">
</a>
</p>


이 프로젝트는 2세대 "진문운 입력기"입니다. 1세대와 비교하여, 2세대는 새로운 디자인 개념과 아키텍처를 도입하여 RIME 엔진을 포함한 모든 입력기 구성 요소를 확장 프로그램 내에 통합했습니다. 따라서 시스템 내에서 별도의 서버를 실행할 필요가 없습니다. emscripten 툴체인을 사용하여 RIME 엔진을 WebAssembly로 컴파일하여 확장 프로그램 환경에서 직접 실행할 수 있도록 했습니다. 또한, 저장 내용과 시작 프로세스를 최적화하여 더욱 빠른 시작과 부드러운 사용자 경험을 보장합니다.

## 기능 개요
- 🌍 **다언어 입력 모드**: 병음, 쌍병, 간체 및 번체 중국어 입력을 지원하며, 한국어와 일본어 입력도 지원합니다.
- 🎛️ **고도의 커스터마이징**: 사용자가 모호음과 후보 단어 수를 자유롭게 설정할 수 있어 개인화된 입력 경험을 제공합니다.
- 📊 **지능형 정렬**: 사용자의 사용 빈도에 따라 자동으로 후보 단어의 표시 순서를 조정하여 더 편리한 입력을 실현합니다.
- 🧠 **개인화된 사용자 사전**: 사용자의 입력 기록에 기반하여 개인화된 사용자 사전을 생성하여 입력 속도와 효율성을 더욱 향상시킵니다.
- 📚 **풍부한 사전**: 주요 중국어 입력기 표준 사전과 인터넷에서 자주 사용하는 단어를 내장하여 입력 경험을 강화합니다.
- 🛠️ **설정 파일 수정 권한**: 설정 파일을 수정할 수 있는 권한을 제공하여 사용자 필요에 따라 입력기 설정을 자유롭게 조정할 수 있습니다.


## 다운로드
- <a href="https://chrome.google.com/webstore/detail/%E7%9C%9F%E6%96%87%E9%9F%B5%E8%BE%93%E5%85%A5%E6%B3%95/ppgpjbgimfloenilfemmcejiiokelkni">
    <img src="https://raw.githubusercontent.com/FydeOS/fydeRhythm/refs/heads/master/media/chromewebstore.png" alt="Chrome Web Store" width="138">
</a>

- [GitHub Release](https://github.com/FydeOS/fydeRhythm/releases)

## 추가 정보
이 프로젝트에 관심이 있고 빌드 프로세스나 내부 구조 등 더 많은 정보를 알고 싶다면, [Wiki](https://github.com/FydeOS/fydeRhythm/wiki) 페이지를 방문해 주세요.