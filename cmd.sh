#!/bin/bash
set -x
npx browser-sync start --server --files "**/*.html, **/*.css, **/*.js" &
npx wrangler pages dev
set +x
