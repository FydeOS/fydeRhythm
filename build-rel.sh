#!/bin/bash
set -e
BUILD_DIR=build/chrome-mv3-prod
rm -r $BUILD_DIR
pnpm run build
rsync -r --exclude .git ../inputview $BUILD_DIR
google-chrome --pack-extension=$BUILD_DIR --pack-extension-key=fydeos-rime-extention.pem
mkdir -p ../rel/
chmod 644 $BUILD_DIR.crx
sudo mv $BUILD_DIR.crx ../rel/rime.crx
