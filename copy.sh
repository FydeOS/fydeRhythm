#!/bin/bash
rm build/chrome-mv3-dev/assets/rime_emscripten.wasm
# SOURCE=/home/fydeos/librime-latest/cmake-build-relwithdebinfo-wasm/bin
# SOURCE=/home/fydeos/librime-latest/cmake-build-debug-wasm/bin
SOURCE=/home/fydeos/librime-latest/cmake-build-release-wasm/bin
cp $SOURCE/rime_emscripten.js background/
cp $SOURCE/rime_emscripten.wasm assets/
