#!/bin/sh
# cron 用的同步包装脚本：加载同目录 .env 里的密钥后跑 sync_caldav.py
DIR=/vol1/1000/docker/caldav
cd "$DIR" || exit 1
set -a
. ./.env
set +a
exec /usr/local/bin/python3.12 "$DIR/sync_caldav.py"
