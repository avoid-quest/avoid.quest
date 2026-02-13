#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONST_FILE="$ROOT_DIR/apps/radio/src/lib/const.ts"

if [[ ! -f "$CONST_FILE" ]]; then
  echo "const.ts not found at $CONST_FILE" >&2
  exit 1
fi

STATIONS=()
while IFS= read -r line; do
  STATIONS+=("$line")
done < <(
  awk '
    /name:[[:space:]]*"/ {
      split($0, parts, "\"")
      if (parts[2] != "") {
        name = parts[2]
      }
    }
    /streamUrl:[[:space:]]*"/ {
      split($0, parts, "\"")
      if (parts[2] != "" && name != "") {
        printf "%s\t%s\n", name, parts[2]
        name = ""
      }
    }
  ' "$CONST_FILE"
)

if [[ ${#STATIONS[@]} -eq 0 ]]; then
  echo "No stations found in $CONST_FILE" >&2
  exit 1
fi

printf "%-26s %-4s %-30s %-5s %s\n" "name" "code" "content-type" "acao" "url"
printf "%-26s %-4s %-30s %-5s %s\n" "--------------------------" "----" "------------------------------" "-----" "---"

for entry in "${STATIONS[@]}"; do
  IFS=$'\t' read -r name url <<<"$entry"
  header_file="$(mktemp)"

  curl -sS -L --max-time 10 --range 0-1023 -D "$header_file" -o /dev/null "$url" >/dev/null 2>&1 || true

  code="$(awk 'BEGIN{IGNORECASE=1} /^HTTP\//{c=$2} END{print c}' "$header_file")"
  content_type="$(awk 'BEGIN{IGNORECASE=1} /^content-type:/{gsub("\r",""); sub(/^content-type:[[:space:]]*/, ""); print; exit}' "$header_file")"
  acao="$(awk 'BEGIN{IGNORECASE=1; found=0} /^access-control-allow-origin:/{found=1} END{print(found ? "yes" : "no")}' "$header_file")"

  rm -f "$header_file"

  [[ -z "$code" ]] && code="ERR"
  [[ -z "$content_type" ]] && content_type="<none>"
  [[ -z "$acao" ]] && acao="no"

  printf "%-26s %-4s %-30s %-5s %s\n" "$name" "$code" "$content_type" "$acao" "$url"
done
