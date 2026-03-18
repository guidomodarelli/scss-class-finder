#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PACKAGE_JSON_PATH="$ROOT_DIR/package.json"

fail() {
  echo "Error: $1" >&2
  exit 1
}

read_package_field() {
  local field_name="$1"

  if command -v jq >/dev/null 2>&1; then
    jq -r ".${field_name}" "$PACKAGE_JSON_PATH"
    return
  fi

  grep -m1 "\"${field_name}\"" "$PACKAGE_JSON_PATH" | cut -d '"' -f4
}

[ -f "$PACKAGE_JSON_PATH" ] || fail "package.json was not found in $ROOT_DIR."
command -v npm >/dev/null 2>&1 || fail "npm is required to compile the extension."
command -v npx >/dev/null 2>&1 || fail "npx is required to package the extension."
command -v code >/dev/null 2>&1 || fail "The VS Code CLI (code) is required to install the extension."

PACKAGE_NAME="$(read_package_field "name")"
PACKAGE_VERSION="$(read_package_field "version")"

[ -n "$PACKAGE_NAME" ] && [ "$PACKAGE_NAME" != "null" ] || fail "Could not read the extension name from package.json."
[ -n "$PACKAGE_VERSION" ] && [ "$PACKAGE_VERSION" != "null" ] || fail "Could not read the extension version from package.json."

VSIX_PATH="$ROOT_DIR/${PACKAGE_NAME}-${PACKAGE_VERSION}.vsix"

cd "$ROOT_DIR"

echo "Compiling extension..."
npm run compile

echo "Packaging extension..."
npx @vscode/vsce package --no-dependencies --allow-missing-repository

[ -f "$VSIX_PATH" ] || fail "Expected package $VSIX_PATH was not generated."

echo "Installing $VSIX_PATH..."
code --install-extension "$VSIX_PATH" --force

echo "Extension installed successfully."
