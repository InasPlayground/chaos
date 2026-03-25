#!/bin/bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <customer>" >&2
    exit 1
fi

CUSTOMER="$1"

# Debug log file
LOG_FILE="${DEBUG_LOG:-debug.log}"
log_debug() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] DEBUG(get_company_name.sh): $*" >> "$LOG_FILE"; }

if ! command -v amstool >/dev/null 2>&1; then
    echo "ERROR: amstool command not found" >&2
    exit 1
fi

log_debug "Executing: amstool info \"$CUSTOMER\" snow"

# Simple approach - run non-interactively with clean locale
export LC_ALL=C LANG=C TERM=dumb
INFO_OUTPUT=$(amstool info "$CUSTOMER" snow </dev/null 2>/dev/null)
rc=$?

log_debug "Exit code: $rc"
log_debug "Output: $INFO_OUTPUT"

if [[ $rc -ne 0 || -z "$INFO_OUTPUT" ]]; then
    echo "ERROR: failed to get info for customer '$CUSTOMER' (exit=$rc)" >&2
    exit 3
fi

# Extract company name - simple approach
COMPANY_NAME=$(echo "$INFO_OUTPUT" | grep "Company Name" | head -n1 | sed 's/Company Name[[:space:]]*//' | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')

if [[ -z "${COMPANY_NAME}" ]]; then
    echo "ERROR: could not extract company name from amstool output" >&2
    exit 4
fi

log_debug "Parsed company name: $COMPANY_NAME"
echo "$COMPANY_NAME"
