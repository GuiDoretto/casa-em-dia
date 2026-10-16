#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Instale primeiro o Node.js 24 LTS em https://nodejs.org/pt'
  exit 1
fi
node iniciar.mjs
