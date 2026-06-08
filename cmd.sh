#!/bin/bash
set -x
npx browser-sync start --server --files "**/*.html, **/*.css, **/*.js"
set +x
