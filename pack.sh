#!/bin/bash
set -e
google-chrome --pack-extension=build/chrome-mv3-prod --pack-extension-key=fydeos-rime-extention.pem
mkdir -p ../rel/
chmod 644 build/chrome-mv3-prod.crx
sudo mv build/chrome-mv3-prod.crx /var/www/html/chinese-rime2.crx
