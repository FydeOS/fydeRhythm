#!/bin/bash
set -e
google-chrome --pack-extension=build/chrome-mv3-prod --pack-extension-key=fydeos-rime-extention.pem
mkdir -p ../rel/
mv build/chrome-mv3-prod.crx ../rel/latest.crx
