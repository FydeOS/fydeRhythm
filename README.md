# 真文韵输入法

真文韵输入法是 FydeOS 团队为 ChromeOS 和 FydeOS 操作系统设计的输入法扩展，其内部基于 [RIME 引擎](https://rime.im/)。

## 构建

本项目使用 pnpm 来管理依赖，因此需要你[安装 pnpm](https://pnpm.io/installation)。推荐使用 Node.js v18，更老的版本可能会出现编译错误。

项目的构建流程：

1. 将 librime 项目编译出的 rime_emscripten.js 文件放在插件的 background 目录下，rime_emscripten.wasm 文件放在插件的 assets 目录下。
2. 运行 `pnpm install` 来安装所有依赖项。
3. 运行 `pnpm build` 来构建插件，构建后的文件将存放于 build/chrome-mv3-prod 目录下。
4. 如需虚拟键盘的支持，则还需要手动将源代码根目录下的 inputview 目录（虚拟键盘）整体复制到 build/chrome-mv3-prod 目录中。
5. 使用 `google-chrome --pack-extension=build/chrome-mv3-prod --pack-extension-key=key.pem` 来打包插件。

> :warning: 如果你自行编译 librime，并且运行了 emscripten SDK 的 `emsdk_env` 环境脚本，则 node 会使用 emsdk 自带的 v14 版本的 node（而非系统安装的版本），老版本 node 在 build 的时候会报错。因此，编译插件时不要在 emsdk 环境下进行。
