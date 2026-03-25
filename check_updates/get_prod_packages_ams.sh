#!/bin/bash

# Script to list last installed packages on production environments using amstool (JSON output)
# Usage: ./get_prod_packages_ams.sh <customer>

echo "🚀 DEBUG: get_prod_packages_ams.sh script started at $(date)" >&2
echo "🚀 DEBUG: Script called with arguments: $*" >&2

set -euo pipefail

# Function to display usage
usage() {
    echo "Usage: $0 <customer> [--minutes N | --hour N | --hours N | --days N]"
    echo "Example: $0 my-customer"
    echo "Example: $0 my-customer --minutes 90"
    echo "Example: $0 my-customer --hours 6"
    echo "Example: $0 my-customer --days 3"
    exit 1
}

# Function to log messages with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >&2
}

# Cross-platform helper: convert "now - N units" to epoch seconds.
epoch_from_now_minus() {
    local amount=$1
    local unit=$2
    if date -d "$amount $unit ago" '+%s' 2>/dev/null; then
        return 0
    fi

    # BSD date on macOS uses different unit suffixes than GNU date.
    case "$unit" in
        minute|minutes)
            date -v-"${amount}"M '+%s'
            ;;
        hour|hours)
            date -v-"${amount}"H '+%s'
            ;;
        day|days)
            date -v-"${amount}"d '+%s'
            ;;
        *)
            return 1
            ;;
    esac
}

# Extract epoch timestamp from a package line.
# Supports: "YYYY-MM-DD", "YYYY-MM-DD HH:MM:SS", "YYYY-MM-DDTHH:MM:SS", and "MM/DD/YYYY".
extract_epoch_from_line() {
    local line="$1"
    python3 - "$line" <<'PY'
import re
import sys
from datetime import datetime

line = sys.argv[1]
patterns = [
    (r"(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})", ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]),
    (r"(\d{4}-\d{2}-\d{2})", ["%Y-%m-%d"]),
    (r"(\d{1,2}/\d{1,2}/\d{4})", ["%m/%d/%Y"]),
]

for pattern, fmts in patterns:
    match = re.search(pattern, line)
    if not match:
        continue
    token = match.group(1)
    for fmt in fmts:
        try:
            print(int(datetime.strptime(token, fmt).timestamp()))
            sys.exit(0)
        except ValueError:
            pass

print("")
PY
}



# Function to detect execution source
detect_execution_source() {
    if [[ -n "${CHROME_EXTENSION:-}" ]]; then
        echo "extension"
    elif [[ -t 0 ]]; then
        echo "cmd line"
    else
        echo "unknown"
    fi
}




# Function to check if jq is available
check_jq() {
    if ! command -v jq &> /dev/null; then
        log "ERROR: jq utility not found. JSON output requires jq to be installed."
        log "Please install jq using: brew install jq (on macOS) or apt-get install jq (on Ubuntu)"
        return 1
    fi
    return 0
}

# Function to check if amstool is available
check_amstool() {
    echo "🚀 DEBUG: Checking if amstool is available..." >&2
    if ! command -v amstool &> /dev/null; then
        log "WARNING: amstool utility not found. Running in fallback mode with empty data."
        return 1
    fi
    return 0
}

# Function to extract company name from amstool info
get_company_name() {
    local customer=$1
    log "Getting company name for topology: $customer"
    
    local helper_script="./get_company_name.sh"
    if [[ -x "$helper_script" ]]; then
        # Prefer external helper with its own timeout/robust parsing
        local company_name
        if ! company_name=$("$helper_script" "$customer" 2>/dev/null); then
            log "WARNING: Helper get_company_name.sh failed for '$customer'"
            return 1
        fi
        company_name=$(echo "$company_name" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
        if [[ -z "$company_name" ]]; then
            log "WARNING: Helper returned empty company name"
            return 1
        fi
        log "Extracted company name: $company_name"
        echo "$company_name"
        return 0
    fi
    
    # Fallback to inline logic if helper not present
    local info_output
    if ! info_output=$(amstool info "$customer" snow 2>/dev/null); then
        log "WARNING: Failed to get company info for customer '$customer'. Change requests will not be fetched."
        return 1
    fi
    local company_name
    company_name=$(echo "$info_output" | awk '/^\s*Company Name/ {sub(/^\s*Company Name\s*/, ""); print $0}' | sed 's/^\s*//; s/\s*$//')
    if [[ -z "$company_name" ]]; then
        company_name=$(echo "$info_output" | grep -i "Company Name" | head -n1 | sed 's/Company Name[[:space:]]*//I' | sed 's/^\s*//; s/\s*$//')
    fi
    if [[ -z "$company_name" ]]; then
        log "WARNING: Could not extract company name from amstool info. Change requests will not be fetched."
        return 1
    fi
    log "Extracted company name: $company_name"
    echo "$company_name"
}

# Function to get application hosts (all hosts except dispatcher hosts)
get_prod_hosts() {
    local customer=$1
    log "Getting hosts for customer: $customer"
    
    # Run amstool list command and filter for application hosts
    log "DEBUG: Executing amstool command: amstool list \"$customer\" -d host"
    local hosts
    if ! hosts=$(gtimeout 60 amstool list "$customer" -d host 2>/dev/null || amstool list "$customer" -d host 2>/dev/null); then
        log "ERROR: Failed to get hosts for customer '$customer'. Please check if the customer exists."
        log "DEBUG: amstool list command failed for customer: $customer"
        exit 1
    fi
    
    log "DEBUG: amstool list command completed successfully for customer: $customer"
    log "DEBUG: Raw host data length: ${#hosts} characters"
    
    # Get all hosts but exclude those containing "-dispatcher"
    local prod_hosts
    prod_hosts=$(echo "$hosts" | grep -v -i "\-dispatcher" || true)
    
    if [[ -z "$prod_hosts" ]]; then
        log "WARNING: No application hosts found for customer '$customer' (after excluding dispatcher hosts)"
        return 1
    fi
    
    log "Found $(echo "$prod_hosts" | wc -l | tr -d ' ') application hosts (excluding dispatcher hosts)"
    echo "$prod_hosts"
}

# Function to get dispatcher hosts (hosts containing "-dispatcher")
get_dispatcher_hosts() {
    local customer=$1
    log "Getting dispatcher hosts for customer: $customer"
    
    # Run amstool list command and filter for dispatcher hosts
    log "DEBUG: Executing amstool command: amstool list \"$customer\" -d host (for dispatchers)"
    local hosts
    if ! hosts=$(gtimeout 60 amstool list "$customer" -d host 2>/dev/null || amstool list "$customer" -d host 2>/dev/null); then
        log "ERROR: Failed to get hosts for customer '$customer'. Please check if the customer exists."
        log "DEBUG: amstool list command failed for customer: $customer (dispatchers)"
        exit 1
    fi
    
    log "DEBUG: amstool list command completed successfully for customer: $customer (dispatchers)"
    log "DEBUG: Raw host data length: ${#hosts} characters"
    
    # Filter hosts containing "-dispatcher"
    local dispatcher_hosts
    dispatcher_hosts=$(echo "$hosts" | grep -i "\-dispatcher" || true)
    
    if [[ -z "$dispatcher_hosts" ]]; then
        log "INFO: No dispatcher hosts found for customer '$customer'"
        return 1
    fi
    
    log "Found $(echo "$dispatcher_hosts" | wc -l | tr -d ' ') dispatcher hosts"
    echo "$dispatcher_hosts"
}

# Function to check dispatcher backups
check_dispatcher_backups() {
    local dispatcher_hosts=$1
    local amstool_log_file=$2
    local target_date=$3
    log "Checking dispatcher backups for date: $target_date"
    
    local all_have_backups=true
    local backup_count=0
    
    while IFS= read -r host; do
        if [[ -n "$host" ]]; then
            log "Checking backups on dispatcher host: $host"
            
            local backup_output
            local backup_cmd="sudo ls /var/local/httpd/backups"
            echo "=== BACKUP CHECK COMMAND ===" >> "$amstool_log_file"
            echo "Host: $host" >> "$amstool_log_file"
            echo "Command: amstool cmd \"$host\" \"$backup_cmd\"" >> "$amstool_log_file"
            echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')" >> "$amstool_log_file"
            echo "" >> "$amstool_log_file"
            
            if backup_output=$(gtimeout 30 amstool cmd "$host" "$backup_cmd" 2>/dev/null || amstool cmd "$host" "$backup_cmd" 2>/dev/null); then
                # Log the command output
                echo "=== COMMAND OUTPUT ===" >> "$amstool_log_file"
                echo "$backup_output" >> "$amstool_log_file"
                echo "" >> "$amstool_log_file"
                echo "===========================================" >> "$amstool_log_file"
                echo "" >> "$amstool_log_file"
                
                # Check if there's a backup folder with target date (format: backup_YYYY-MM-DD_HH:MM:SS)
                if echo "$backup_output" | grep -q "backup_${target_date}_"; then
                    log "✓ Found backup for $target_date on $host"
                    ((backup_count++))
                else
                    log "✗ No backup found for $target_date on $host"
                    all_have_backups=false
                fi
            else
                log "✗ Failed to check backups on $host"
                all_have_backups=false
            fi
        fi
    done <<< "$dispatcher_hosts"
    
    if [[ "$backup_count" -gt 0 ]]; then
        log "✓ Found backups for $target_date on $backup_count dispatcher hosts (out of $(echo "$dispatcher_hosts" | wc -l | tr -d ' ') total)"
        return 0
    else
        log "✗ No dispatcher hosts have backup for $target_date"
        return 1
    fi
}

# Function to extract build info from azcopy jobs
extract_build_info() {
    local host=$1
    local output_dir=$2
    local customer=$3
    local amstool_log_file="$output_dir/${customer}-amstool_disp.log"
    log "Extracting build info from dispatcher host: $host"
    
    local azcopy_output
    local azcopy_cmd="sudo /opt/bin/azcopy jobs list >/tmp/azcopy_output.txt 2>&1; cat /tmp/azcopy_output.txt;"
    echo "=== BUILD EXTRACTION COMMAND ===" >> "$amstool_log_file"
    echo "Host: $host" >> "$amstool_log_file"
    echo "Command: amstool cmd \"$host\" \"$azcopy_cmd\"" >> "$amstool_log_file"
    echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')" >> "$amstool_log_file"
    echo "" >> "$amstool_log_file"
    
    if azcopy_output=$(gtimeout 30 amstool cmd "$host" "$azcopy_cmd" 2>/dev/null || amstool cmd "$host" "$azcopy_cmd" 2>/dev/null); then
        # Log the command output to amstool_disp.log
        echo "=== COMMAND OUTPUT ===" >> "$amstool_log_file"
        echo "$azcopy_output" >> "$amstool_log_file"
        echo "" >> "$amstool_log_file"
        echo "===========================================" >> "$amstool_log_file"
        echo "" >> "$amstool_log_file"
        
        # Save azcopy output to log file for debugging
        local log_file="$output_dir/${customer}-azcopy-debug-$(date '+%Y%m%d-%H%M%S').log"
        {
            echo "=== AZCOPY DEBUG LOG ==="
            echo "Customer: $customer"
            echo "Host: $host"
            echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
            echo "Command: amstool cmd \"$host\" \"sudo /opt/bin/azcopy jobs list >/tmp/azcopy_output.txt 2>&1; cat /tmp/azcopy_output.txt;\""
            echo ""
            echo "=== RAW AZCOPY OUTPUT ==="
            echo "$azcopy_output"
            echo ""
            echo "=== END AZCOPY OUTPUT ==="
        } > "$log_file"
        log "DEBUG: Azcopy output saved to: $log_file"
        
        log "DEBUG: Raw azcopy output:"
        echo "--- AZCOPY OUTPUT START ---" >&2
        echo "$azcopy_output" >&2
        echo "--- AZCOPY OUTPUT END ---" >&2
        
        # Extract build version - try multiple patterns
        local build_version
        
        # First try to extract from the clean text format (most reliable)
        log "DEBUG: Attempting to extract build from azcopy jobs list..."
        # Look for the first "Command:" line and extract dispatcher version
        build_version=$(echo "$azcopy_output" | grep -A 1 "Command:" | grep -oE 'dispatcher-[0-9.]+\.zip' | head -n1 | sed 's/\.zip//g')
        if [[ -n "$build_version" ]]; then
            log "DEBUG: Text format extraction result: '$build_version'"
        fi
        
        # Pattern 1: Look for dispatcher-VERSION.zip in Command lines (most common format)
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep "Command:" | grep -oE 'dispatcher-[0-9.]+\.zip' | head -n1 | sed 's/\.zip//g')
            log "DEBUG: Pattern 1 (dispatcher-VERSION.zip in Command) result: '$build_version'"
        fi
        
        # Pattern 1b: Look for .dispatcher.ams-VERSION.zip (Etihad format) - stop at URL parameters
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '\.dispatcher\.ams-[^?[:space:]]+\.zip' | sed 's/\.dispatcher\.ams-//g' | sed 's/\.zip//g' | head -n1)
            log "DEBUG: Pattern 1b (.dispatcher.ams-VERSION.zip) result: '$build_version'"
        fi
        
        # Pattern 2: Look for dispatcher-ams-VERSION.zip (Lufthansa format) - stop at URL parameters
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE 'dispatcher-ams-[^?[:space:]]+\.zip' | sed 's/dispatcher-ams-//g' | sed 's/\.zip//g' | head -n1)
            log "DEBUG: Pattern 2 (dispatcher-ams-VERSION.zip) result: '$build_version'"
        fi
        
        # Pattern 3: Look for -dispatcher-VERSION.zip (legacy format) - stop at URL parameters  
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '\-dispatcher\-[^?[:space:]]+\.zip' | sed 's/\-dispatcher\-//g' | sed 's/\.zip//g' | head -n1)
            log "DEBUG: Pattern 3 (-dispatcher-VERSION.zip) result: '$build_version'"
        fi
        
        # Pattern 4: Extract any filename from /build/ directory that looks like a version
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '/build/[^/?[:space:]]*\.zip' | sed 's|.*/build/||g' | sed 's/\.zip//g' | head -n1)
            log "DEBUG: Pattern 4 (/build/filename.zip) result: '$build_version'"
        fi
        
        # Pattern 3b: Extract version from full filename if it contains dispatcher.ams-
        if [[ -n "$build_version" ]] && [[ "$build_version" =~ dispatcher\.ams- ]]; then
            local temp_version="$build_version"
            build_version=$(echo "$temp_version" | grep -oE 'dispatcher\.ams-.*' | sed 's/dispatcher\.ams-//g')
            log "DEBUG: Pattern 3b (extract from dispatcher.ams- filename) result: '$build_version'"
        fi
        
        # Pattern 3c: Look for version pattern YYYY.DDD.HHMMSS.XXXXXXXXXX (etihad specific)
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '20[0-9][0-9]\.[0-9][0-9][0-9]\.[0-9][0-9][0-9][0-9][0-9][0-9]\.[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]' | head -n1)
            log "DEBUG: Pattern 3c (YYYY.DDD.HHMMSS.XXXXXXXXXX format) result: '$build_version'"
        fi
        
        # Pattern 4: Look for version numbers in format X.X.X.XXXX_XXXX_XXXXXX_XXXXXXXXXX
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+_[0-9]+_[0-9]+_[0-9]+' | head -n1)
            log "DEBUG: Pattern 4 (X.X.X.X_X_X_X format) result: '$build_version'"
        fi
        
        # Pattern 5: Look for standard version numbers X.X.X.X
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
            log "DEBUG: Pattern 5 (X.X.X.X) result: '$build_version'"
        fi
        
        # Pattern 6: Look for any .zip files and extract everything before .zip
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '[a-zA-Z0-9._-]*[0-9]+\.[0-9]+[a-zA-Z0-9._-]*\.zip' | sed 's/\.zip//g' | head -n1)
            log "DEBUG: Pattern 6 (*.zip with version) result: '$build_version'"
        fi
        
        # Pattern 7: Look for any string that looks like a version number (more flexible)
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '[0-9]{4}\.[0-9]{3}\.[0-9]{6}\.[0-9]{10}' | head -n1)
            log "DEBUG: Pattern 7 (flexible version) result: '$build_version'"
        fi
        
        # Pattern 8: Look for any numeric version pattern in the output
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
            log "DEBUG: Pattern 8 (any numeric version) result: '$build_version'"
        fi
        
        # Pattern 9: Look for build numbers in various formats
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE 'build[_-]?[0-9]+' | sed 's/build[_-]?//g' | head -n1)
            log "DEBUG: Pattern 9 (build number) result: '$build_version'"
        fi
        
        # Pattern 10: Look for any dispatcher-related files in JSON or text output
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE 'dispatcher[^/]*\.zip' | sed 's/\.zip//g' | head -n1)
            log "DEBUG: Pattern 10 (any dispatcher.zip) result: '$build_version'"
        fi
        
        # Pattern 11: Look for version numbers in JSON Source field
        if [[ -z "$build_version" ]]; then
            build_version=$(echo "$azcopy_output" | grep -oE '"Source"[^"]*dispatcher[^"]*' | grep -oE '[0-9]+\.[0-9]+[^"]*' | head -n1)
            log "DEBUG: Pattern 11 (JSON Source field) result: '$build_version'"
        fi
        
        if [[ -n "$build_version" ]]; then
            log "✓ Extracted build version: $build_version"
            echo "$build_version"
            return 0
        else
            log "✗ Could not extract build version from azcopy output using any pattern"
            log "DEBUG: Full azcopy output for manual inspection:"
            echo "--- FULL AZCOPY OUTPUT ---" >&2
            echo "$azcopy_output" >&2
            echo "--- END FULL AZCOPY OUTPUT ---" >&2
            
            # Save detailed debug information
            local debug_file="$output_dir/${customer}-build-extraction-debug-$(date '+%Y%m%d-%H%M%S').log"
            {
                echo "=== BUILD EXTRACTION DEBUG ==="
                echo "Customer: $customer"
                echo "Host: $host"
                echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
                echo "Command: $azcopy_cmd"
                echo ""
                echo "=== FULL AZCOPY OUTPUT ==="
                echo "$azcopy_output"
                echo ""
                echo "=== EXTRACTION ATTEMPTS ==="
                echo "Tried 11 different patterns to extract build version"
                echo "Patterns included: JSON extraction, dispatcher.ams-*, dispatcher-ams-*, -dispatcher-*, /build/*.zip, and various version number formats"
                echo ""
                echo "=== SUGGESTIONS ==="
                echo "1. Check if azcopy jobs are actually running on this host"
                echo "2. Verify the azcopy command syntax and permissions"
                echo "3. Check if the host has the expected dispatcher build files"
                echo "4. Review the raw output above for any build-related information"
            } > "$debug_file"
            log "DEBUG: Detailed build extraction debug saved to: $debug_file"
            
            return 1
        fi
    else
        log "✗ Failed to get azcopy jobs from $host"
        log "DEBUG: Command failed - checking error output on host..."
        
        # Log the failed command to amstool_disp.log
        echo "=== COMMAND FAILED ===" >> "$amstool_log_file"
        echo "Host: $host" >> "$amstool_log_file"
        echo "Command: amstool cmd \"$host\" \"$azcopy_cmd\"" >> "$amstool_log_file"
        echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')" >> "$amstool_log_file"
        echo "Status: FAILED" >> "$amstool_log_file"
        echo "" >> "$amstool_log_file"
        
        # Try to get error output from the host
        local error_output
        if error_output=$(gtimeout 10 amstool cmd "$host" "cat /tmp/azcopy_output.txt 2>/dev/null" 2>/dev/null || amstool cmd "$host" "cat /tmp/azcopy_output.txt 2>/dev/null" 2>/dev/null); then
            log "ERROR OUTPUT:"
            echo "--- ERROR OUTPUT START ---" >&2
            echo "$error_output" >&2
            echo "--- ERROR OUTPUT END ---" >&2
            
            # Log error output to amstool_disp.log
            echo "=== ERROR OUTPUT ===" >> "$amstool_log_file"
            echo "$error_output" >> "$amstool_log_file"
            echo "" >> "$amstool_log_file"
        else
            log "Could not retrieve error output from $host"
            echo "Could not retrieve error output from host" >> "$amstool_log_file"
        fi
        
        echo "===========================================" >> "$amstool_log_file"
        echo "" >> "$amstool_log_file"
        
        return 1
    fi
}

# Function to get modified files from dispatcher
get_modified_files() {
    local host=$1
    local target_date=$2
    local amstool_log_file=$3
    log "Getting modified files from dispatcher host: $host for date: $target_date"
    
    local modified_files
    local find_cmd
    
    # Build the find command based on date
    if [[ "$target_date" == "$(date '+%Y-%m-%d')" ]]; then
        # For today, use -newermt with current date
        find_cmd="sudo find /etc/httpd/ -type f -newermt '$target_date'"
    else
        # For specific date, use -newermt with date and ! -newermt with next day
        local next_date=$(date -d "$target_date + 1 day" '+%Y-%m-%d' 2>/dev/null || date -j -v+1d -f '%Y-%m-%d' "$target_date" '+%Y-%m-%d')
        find_cmd="sudo find /etc/httpd/ -type f -newermt '$target_date' ! -newermt '$next_date'"
    fi
    
    log "Using find command: $find_cmd"
    
    # Log the command to amstool_disp.log
    echo "=== MODIFIED FILES CHECK COMMAND ===" >> "$amstool_log_file"
    echo "Host: $host" >> "$amstool_log_file"
    echo "Command: amstool cmd \"$host\" \"$find_cmd\"" >> "$amstool_log_file"
    echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')" >> "$amstool_log_file"
    echo "" >> "$amstool_log_file"
    
    if modified_files=$(gtimeout 30 amstool cmd "$host" "$find_cmd" 2>/dev/null || amstool cmd "$host" "$find_cmd" 2>/dev/null); then
        # Log the command output to amstool_disp.log
        echo "=== COMMAND OUTPUT ===" >> "$amstool_log_file"
        echo "$modified_files" >> "$amstool_log_file"
        echo "" >> "$amstool_log_file"
        echo "===========================================" >> "$amstool_log_file"
        echo "" >> "$amstool_log_file"
        
        # Filter out [INFO]: lines and other non-file lines, keep only actual file paths
        # Note: Files may have leading whitespace, so we trim it and look for lines containing /
        local clean_files
        clean_files=$(echo "$modified_files" | grep -v "^\[INFO\]:" | sed 's/^[[:space:]]*//' | grep "^/" | sort -u)
        
        if [[ -n "$clean_files" ]]; then
            local file_count=$(echo "$clean_files" | wc -l | tr -d ' ')
            log "✓ Found $file_count modified files (after filtering)"
            echo "$clean_files"
            return 0
        else
            log "ℹ No modified files found in the last 24 hours (after filtering)"
            echo "No modified files found"
            return 0
        fi
    else
        log "✗ Failed to get modified files from $host (amstool cmd failed)"
        return 1
    fi
}

# Function to monitor dispatcher deployment
monitor_dispatcher_deployment() {
    local customer=$1
    local output_dir=$2
    local target_date=$3
    
    log "Starting dispatcher deployment monitoring..."
    
    # Get dispatcher hosts
    local dispatcher_hosts
    if ! dispatcher_hosts=$(get_dispatcher_hosts "$customer"); then
        log "INFO: No dispatcher monitoring - no dispatcher hosts found"
        return 0
    fi
    
    # Create amstool dispatcher command log file
    local amstool_disp_log="$output_dir/${customer}-amstool_disp.log"
    {
        echo "AMSTOOL DISPATCHER COMMANDS LOG - $(date '+%Y-%m-%d %H:%M:%S')"
        echo "============================================================="
        echo "Customer: $customer"
        echo "Dispatcher hosts checked: $(echo "$dispatcher_hosts" | wc -l | tr -d ' ')"
        echo ""
        echo "This log contains all amstool commands executed on dispatcher hosts"
        echo "for debugging and verification purposes."
        echo ""
        echo "============================================================="
        echo ""
    } > "$amstool_disp_log"

    # Check ALL dispatcher hosts for modified files in the last 24 hours
    local all_modified_files=""
    local dispatcher_count=0
    
    while IFS= read -r host; do
        if [[ -n "$host" ]]; then
            ((dispatcher_count++))
            log "Checking dispatcher $dispatcher_count: $host"
            
            # Get modified files from this dispatcher
            local modified_files
            log "Getting modified files from dispatcher host: $host"
            if modified_files=$(get_modified_files "$host" "$target_date" "$amstool_disp_log"); then
                if [[ "$modified_files" != "No modified files found" ]]; then
                    log "✓ Found modified files on $host"
                    if [[ -n "$all_modified_files" ]]; then
                        all_modified_files="${all_modified_files}\n\n=== MODIFIED FILES FOUND ON: $host ===\n${modified_files}"
                    else
                        all_modified_files="=== MODIFIED FILES FOUND ON: $host ===\n${modified_files}"
                    fi
                else
                    log "ℹ No modified files on $host in the last 24 hours"
                fi
            else
                log "✗ Failed to get modified files from $host"
                if [[ -n "$all_modified_files" ]]; then
                    all_modified_files="${all_modified_files}\n\n=== ERROR ON: $host ===\nFailed to retrieve modified files"
                else
                    all_modified_files="=== ERROR ON: $host ===\nFailed to retrieve modified files"
                fi
            fi
        fi
    done <<< "$dispatcher_hosts"
    
    # Set final modified files result
    if [[ -n "$all_modified_files" ]]; then
        modified_files="$all_modified_files"
    else
        modified_files="No modified files found on any dispatcher in the last 24 hours"
    fi
    
    log "Checked $dispatcher_count dispatcher hosts for modified files"
    
    # Check if any dispatcher hosts have backup for the target date
    local build_info=""
    local should_extract_build=false
    
    if check_dispatcher_backups "$dispatcher_hosts" "$amstool_disp_log" "$target_date"; then
        log "✓ Dispatcher backups found - extracting build version"
        should_extract_build=true
    elif [[ "$modified_files" != "No modified files found on any dispatcher in the last 24 hours" ]]; then
        log "✓ Modified files found on dispatchers - attempting build extraction even without backups"
        should_extract_build=true
    else
        log "INFO: No dispatcher hosts have backup for $target_date and no modified files found"
        build_info="No CM deployment on $target_date"
    fi
    
    if [[ "$should_extract_build" == true ]]; then
        # Extract build information
        # Get the first dispatcher host from the list
        local first_host
        first_host=$(echo "$dispatcher_hosts" | head -n1 | tr -d '[:space:]')

        local build_version
        if [[ -n "$first_host" ]] && build_version=$(extract_build_info "$first_host" "$output_dir" "$customer"); then
            log "✓ Successfully extracted build version: $build_version"
            build_info="CM deploy on $target_date - new build $build_version"
        else
            log "✗ Failed to extract build version (first_host: '$first_host')"
            if check_dispatcher_backups "$dispatcher_hosts" "$amstool_disp_log" "$target_date" >/dev/null 2>&1; then
                build_info="CM deploy on $target_date - backup exists but could not extract build version"
            else
                build_info="CM deploy on $target_date - modified files found but could not extract build version"
            fi
        fi
    fi
    
    # Create dispatcher output with timestamp (always include modified files)
    local dispatcher_info_file="$output_dir/${customer}-dispatcher-info-$(date '+%Y%m%d-%H%M%S').txt"
    {
        echo "Dispatcher Analysis - $(date '+%Y-%m-%d %H:%M:%S')"
        echo "=========================================="
        echo "Customer: $customer"
        echo "Dispatcher hosts checked: $dispatcher_count"
        echo ""
        echo "Build Status:"
        echo "$build_info"
        echo ""
        echo "Dispatchers checked:"
        # List all dispatcher hosts that were checked
        while IFS= read -r host; do
            if [[ -n "$host" ]]; then
                echo "• $host"
            fi
        done <<< "$dispatcher_hosts"
        echo ""
        echo "Modified Files in Last 24 Hours:"
        echo "================================="
        if [[ -n "$modified_files" ]]; then
            echo -e "$modified_files"
        else
            echo "No modified files found on any dispatcher in the last 24 hours"
        fi
    } > "$dispatcher_info_file"
    
    log "✓ Dispatcher information saved to: $dispatcher_info_file"
    
    # Return the info for appending to main output (simplified for CSV append)
    echo "Dispatcher:"
    echo "$build_info"
    echo "Modified files are:"
    # List all dispatcher hosts that were checked
    while IFS= read -r host; do
        if [[ -n "$host" ]]; then
            echo "[INFO]: $host"
        fi
    done <<< "$dispatcher_hosts"
    if [[ -n "$modified_files" ]]; then
        echo -e "$modified_files"
    else
        echo "No modified files found on any dispatcher in the last 24 hours"
    fi
    return 0
}

# Function to get packages for a host
get_host_packages() {
    local host=$1
    local target_date=$2
    local target_epoch=$3
    local time_filter_label=$4
    log "Getting packages for host: $host using filter: $time_filter_label"
    
    local all_packages
    
    # First, get all packages from the host with timeout (reduced to 15 seconds for faster failure)
    log "DEBUG: Executing amstool command: amstool aem \"$host\" listpackages"
    log "DEBUG: Command will timeout after 15 seconds"
    
    if ! all_packages=$(gtimeout 15 amstool aem "$host" listpackages 2>/dev/null || amstool aem "$host" listpackages 2>/dev/null); then
        log "WARNING: Failed to connect to host '$host' or retrieve packages (timeout after 15s)"
        log "DEBUG: amstool command failed or timed out for host: $host"
        return 1
    fi
    
    log "DEBUG: amstool command completed successfully for host: $host"
    log "DEBUG: Package data length: ${#all_packages} characters"
    
    # Check if amstool returned a failure message (amstool returns exit 0 even on failure)
    if [[ "$all_packages" =~ \[FAILED\] ]]; then
        log "WARNING: Failed to connect to host '$host' - amstool returned failure"
        return 1
    fi
    
    # Parse and filter packages by installation time window
    local packages
    packages=""
    
    # Process each package line to check installation timestamp
    local package_count=0
    local matching_count=0
    
    while IFS= read -r package_line; do
        if [[ -z "$package_line" || "$package_line" =~ ^[[:space:]]*$ ]]; then
            continue
        fi

        ((package_count++))

        local package_epoch
        package_epoch=$(extract_epoch_from_line "$package_line")

        if [[ -n "$package_epoch" && "$package_epoch" -ge "$target_epoch" ]]; then
            ((matching_count++))
            if [[ -z "$packages" ]]; then
                packages="$package_line"
            else
                packages="$packages"$'\n'"$package_line"
            fi
        fi
    done <<< "$all_packages"
    
    log "DEBUG: Processed $package_count packages, found $matching_count matching $time_filter_label"
    
    # If no packages for time window, that's OK - just return empty (not an error)
    if [[ -z "$packages" ]]; then
        log "INFO: No packages installed for $time_filter_label on host '$host'"
        return 0  # Success, but no packages for this time window
    fi
    
    echo "$packages"
}

# Function to create JSON output
create_json_output() {
    local customer=$1
    local output_file="$customer.json"
    
    log "Creating JSON output file: $output_file"
    
    # Initialize JSON structure
    echo '{"customer": "'$customer'", "timestamp": "'$(date -Iseconds)'", "packages": []}' > "$output_file"
    
    return 0
}

# Function to parse and append package data to JSON
append_to_json() {
    local host=$1
    local packages_output=$2
    local output_file=$3
    
    # Create temporary file for processing
    local temp_file="/tmp/package_temp_$$.json"
    
    # Read current JSON and extract packages array
    local current_packages=$(jq -r '.packages' "$output_file" 2>/dev/null || echo '[]')
    
    # Parse the amstool aem listpackages output and create JSON entries
    local package_entries="[]"
    while IFS= read -r line; do
        # Skip empty lines and headers
        if [[ -z "$line" || "$line" =~ ^[[:space:]]*$ ]]; then
            continue
        fi
        
        # Parse package information (adjust parsing logic based on actual output format)
        if [[ "$line" =~ ^[[:space:]]*[^[:space:]] ]]; then
            # Extract package details - basic parsing that can be improved based on actual output
            local package_info=$(echo "$line" | tr -s ' ')
            
            # Create JSON object for this package
            local json_entry=$(jq -n \
                --arg host "$host" \
                --arg package_info "$package_info" \
                --arg timestamp "$(date -Iseconds)" \
                '{
                    "host": $host,
                    "package_info": $package_info,
                    "timestamp": $timestamp
                }')
            
            # Add to package entries array
            package_entries=$(echo "$package_entries" | jq ". + [$json_entry]")
        fi
    done <<< "$packages_output"
    
    # Merge with existing packages
    local merged_packages=$(echo "$current_packages" | jq ". + $package_entries")
    
    # Update the main JSON file
    jq --argjson packages "$merged_packages" '.packages = $packages' "$output_file" > "$temp_file"
    mv "$temp_file" "$output_file"
}

# Function to create fallback data when amstool is not available
create_fallback_data() {
    local customer="$1"
    local target_date="$2"
    local output_dir="$3"
    
    log "Creating fallback data for customer: $customer"
    
    # Create empty packages JSON
    local packages_json="$output_dir/$customer.json"
    cat > "$packages_json" << EOF
{
  "customer": "$customer",
  "timestamp": "$(date -Iseconds)",
  "status": "Not Available - amstool not installed",
  "packages": [
    {
      "install_date": "$target_date",
      "host": "No data available - amstool not installed",
      "package_name": "No packages found",
      "version": "0.0.0",
      "status": "Not Available"
    }
  ],
  "note": "This is fallback data. Install amstool for real data."
}
EOF
    
    # Create empty dispatcher info
    local dispatcher_info="$output_dir/$customer-dispatcher-info-$(date '+%Y%m%d-%H%M%S').txt"
    cat > "$dispatcher_info" << EOF
Dispatcher Information for $customer
Generated: $(date '+%Y-%m-%d %H:%M:%S')
Status: Not Available - amstool not installed
Note: This is fallback data. Install amstool for real data.
EOF
    
    # Create empty change requests JSON
    local change_requests="$output_dir/$customer-change-requests.json"
    cat > "$change_requests" << EOF
[]
EOF
    
    log "Fallback data created successfully"
    log "Packages JSON: $packages_json"
    log "Dispatcher info: $dispatcher_info"
    log "Change requests: $change_requests"
}

# Main function
main() {
    
    # Parse arguments
    local customer=""
    local target_date=""
    local target_epoch=""
    local minutes_back=""
    local hours_back=""
    local days_back=""
    local time_filter_label=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --minutes)
                if [[ $# -lt 2 || ! "$2" =~ ^[0-9]+$ || "$2" -le 0 ]]; then
                    echo "Error: --minutes requires a positive integer"
                    usage
                fi
                minutes_back="$2"
                shift 2
                ;;
            --hour|--hours)
                if [[ $# -lt 2 || ! "$2" =~ ^[0-9]+$ || "$2" -le 0 ]]; then
                    echo "Error: --hour/--hours requires a positive integer"
                    usage
                fi
                hours_back="$2"
                shift 2
                ;;
            --days)
                if [[ $# -lt 2 || ! "$2" =~ ^[0-9]+$ || "$2" -le 0 ]]; then
                    echo "Error: --days requires a positive integer"
                    usage
                fi
                days_back="$2"
                shift 2
                ;;
            *)
                if [[ -z "$customer" ]]; then
                    customer="$1"
                else
                    echo "Error: Unknown argument '$1'"
                    usage
                fi
                shift
                ;;
        esac
    done
    
    # Check if customer argument is provided
    if [[ -z "$customer" ]]; then
        usage
    fi
    
    echo "🚀 DEBUG: Customer parsed: '$customer'" >&2

    # Validate mutually exclusive time-window inputs
    local option_count=0
    [[ -n "$minutes_back" ]] && ((option_count++))
    [[ -n "$hours_back" ]] && ((option_count++))
    [[ -n "$days_back" ]] && ((option_count++))
    if [[ $option_count -gt 1 ]]; then
        echo "Error: use only one of --minutes, --hour/--hours, or --days"
        usage
    fi

    # Default behavior: analyze the last 24 hours
    if [[ -z "$minutes_back" && -z "$hours_back" && -z "$days_back" ]]; then
        hours_back="24"
    fi

    if [[ -n "$minutes_back" ]]; then
        target_epoch=$(epoch_from_now_minus "$minutes_back" "minutes")
        time_filter_label="last ${minutes_back} minute(s)"
    elif [[ -n "$hours_back" ]]; then
        target_epoch=$(epoch_from_now_minus "$hours_back" "hours")
        time_filter_label="last ${hours_back} hour(s)"
    else
        target_epoch=$(epoch_from_now_minus "$days_back" "days")
        time_filter_label="last ${days_back} day(s)"
    fi

    target_date=$(date -r "$target_epoch" '+%Y-%m-%d' 2>/dev/null || date -j -f '%s' "$target_epoch" '+%Y-%m-%d')

    if [[ -z "$target_epoch" || -z "$target_date" ]]; then
        log "ERROR: Failed to compute time window"
        exit 1
    fi
    
    echo "🚀 DEBUG: Target date set to: '$target_date'" >&2
    
    local output_file=""
    local output_dir=""
    
    log "Starting package listing for customer: $customer, filter: $time_filter_label (base date: $target_date)"
    echo "🚀 DEBUG: About to start main processing..." >&2
    
    # Create output directory for this execution using target date
    target_date_formatted=$(echo "$target_date" | sed 's/-//g')  # Convert YYYY-MM-DD to YYYYMMDD
    output_dir="${customer}_${target_date_formatted}"
    if [[ ! -d "$output_dir" ]]; then
        mkdir -p "$output_dir"
        log "Created output directory: $output_dir"
    else
        log "Using existing output directory: $output_dir"
    fi
    
    # Check if jq is available
    if ! check_jq; then
        log "ERROR: jq is required for JSON output but not found"
        exit 1
    fi
    
    # Check if amstool is available
    if ! check_amstool; then
        log "Running in fallback mode - amstool not available"
        create_fallback_data "$customer" "$target_date" "$output_dir"
        return 0
    fi
    
    # Fetch change requests EARLY (simple path) so this always runs quickly
    # Create JSON output path now; CSV append will happen later after analysis
    local python_script="./now_get_cloud_manager_changes_custname.py"
    local change_requests_file="$output_dir/${customer}-change-requests.json"
    if [[ -x "./get_company_name.sh" && -f "$python_script" ]]; then
        local company_name
        if company_name=$(./get_company_name.sh "$customer" 2>/dev/null); then
            log "Running change requests script for company: $company_name (early step)"
            if python3 "$python_script" -c "$company_name" -d "$target_date" > "$change_requests_file" 2>/dev/null; then
                log "✓ Change requests saved to: $change_requests_file"
            else
                log "WARNING: Failed to fetch change requests in early step"
            fi
        else
            log "WARNING: Could not extract company name in early step, skipping initial change requests fetch"
        fi
    else
        log "INFO: Skipping early change requests fetch (helper or script not found)"
    fi

    # Get production hosts
    local prod_hosts
    if ! prod_hosts=$(get_prod_hosts "$customer"); then
        log "ERROR: No production hosts found or error occurred"
        exit 1
    fi
    
    # Create output file in the customer directory
    output_file="$output_dir/$customer-prod-packages-$(date '+%Y%m%d-%H%M%S').json"
    log "Creating JSON output file: $output_file"
    
    # Initialize JSON structure
    cat > "$output_file" << EOF
{
  "customer": "$customer",
  "timestamp": "$(date -Iseconds)",
  "target_date": "$target_date",
  "hosts": []
}
EOF
    
    # Process each production host
    local host_count=0
    local success_count=0
    
    while IFS= read -r host; do
        if [[ -n "$host" ]]; then
            ((host_count++))
            log "Processing host $host_count: $host"
            
            local packages
            if packages=$(get_host_packages "$host" "$target_date" "$target_epoch" "$time_filter_label"); then
                # Append packages to JSON
                local temp_file="/tmp/packages_temp_$$.json"
                local host_packages="[]"
                
                if [[ -n "$packages" ]]; then
                    # Process each line of package output and create JSON array
                    while IFS= read -r package_line; do
                        # Skip empty lines
                        if [[ -n "$package_line" && ! "$package_line" =~ ^[[:space:]]*$ ]]; then
                            # Create JSON object for this package
                            local package_json=$(jq -n \
                                --arg package_info "$package_line" \
                                --arg timestamp "$(date -Iseconds)" \
                                '{
                                    "package_info": $package_info,
                                    "parsed_at": $timestamp
                                }')
                            host_packages=$(echo "$host_packages" | jq ". + [$package_json]")
                        fi
                    done <<< "$packages"
                    ((success_count++))
                else
                    log "WARNING: No packages found for host '$host'"
                    # Add empty packages array for this host
                    host_packages='[]'
                fi
                
                # Create host entry
                local host_entry=$(jq -n \
                    --arg hostname "$host" \
                    --arg status "success" \
                    --argjson packages "$host_packages" \
                    --arg processed_at "$(date -Iseconds)" \
                    '{
                        "hostname": $hostname,
                        "status": $status,
                        "packages": $packages,
                        "processed_at": $processed_at
                    }')
                
                # Add host entry to main JSON
                jq --argjson host_entry "$host_entry" '.hosts += [$host_entry]' "$output_file" > "$temp_file"
                mv "$temp_file" "$output_file"
            else
                log "ERROR: Failed to get packages for host '$host' (timeout or connection error) - skipping and continuing with next host"
                
                # Add error entry for this host
                local temp_file="/tmp/packages_temp_$$.json"
                local host_entry=$(jq -n \
                    --arg hostname "$host" \
                    --arg status "error" \
                    --arg error_message "Error retrieving packages (timeout or connection error)" \
                    --arg processed_at "$(date -Iseconds)" \
                    '{
                        "hostname": $hostname,
                        "status": $status,
                        "error": $error_message,
                        "packages": [],
                        "processed_at": $processed_at
                    }')
                
                jq --argjson host_entry "$host_entry" '.hosts += [$host_entry]' "$output_file" > "$temp_file"
                mv "$temp_file" "$output_file"
            fi
        fi
    done <<< "$prod_hosts"
    
    log "Processing complete!"
    log "Total production hosts found: $host_count"
    log "Successfully processed hosts: $success_count"
    log "Failed hosts (timeout/error): $((host_count - success_count))"
    log "Output saved to: $output_file"
    
    # Display summary
    echo ""
    echo "Summary:"
    echo "========="
    echo "Customer: $customer"
    echo "Production hosts found: $host_count"
    echo "Successfully processed: $success_count"
    echo "Output file: $output_file"
    echo ""
    
    if [[ -f "$output_file" ]]; then
        local host_count_from_file
        host_count_from_file=$(jq '.hosts | length' "$output_file" 2>/dev/null || echo "0")
        echo "JSON file contains $host_count_from_file host entries"
        echo "Sample JSON structure:"
        # Use jq limit to avoid SIGPIPE from head command
        jq -r '
            if .hosts then
                .hosts[0:1] as $limited_hosts |
                {
                    customer: .customer,
                    timestamp: .timestamp,
                    target_date: .target_date,
                    hosts: $limited_hosts
                }
            else
                .
            end
        ' "$output_file" 2>/dev/null || echo '{"error": "Could not parse JSON"}'
        echo ""
        
        # Skip package analysis - Chrome extension uses main JSON directly
        log "Skipping unused analysis JSON generation - proceeding to dispatcher monitoring..."
            
        # Monitor dispatcher deployment directly and enhance main JSON
        log "Starting dispatcher deployment monitoring..."
        echo ""
        echo "DISPATCHER DEPLOYMENT MONITORING"
        echo "================================"
        
        local dispatcher_info
        if dispatcher_info=$(monitor_dispatcher_deployment "$customer" "$output_dir" "$target_date"); then
            log "✓ Dispatcher monitoring completed successfully"
            
            # Enhance the main JSON file with improved status message and structured dispatcher details
            log "Enhancing main JSON file with improved status message and dispatcher details..."
                    
                    # Use the main packages file instead of analysis file
                    local main_json_file="$output_dir/$customer.json"
                    
                    # First create the main JSON file from the prod-packages file
                    if [[ ! -f "$main_json_file" ]]; then
                        # Find the most recent prod-packages file
                        local prod_packages_file=$(find "$output_dir" -name "$customer-prod-packages-*.json" | sort | tail -1)
                        if [[ -f "$prod_packages_file" ]]; then
                            log "Creating main JSON file from: $prod_packages_file"
                            cp "$prod_packages_file" "$main_json_file"
                        else
                            log "WARNING: No prod-packages file found, creating empty structure"
                            cat > "$main_json_file" << EOF
{
  "customer": "$customer",
  "timestamp": "$(date -Iseconds)",
  "target_date": "$target_date",
  "hosts": []
}
EOF
                        fi
                    fi
                    
                    # Get existing data from main JSON
                    local packages_count=$(jq '[.hosts[]?.packages[]?] | length' "$main_json_file" 2>/dev/null || echo '0')
                    
                    # Extract host list from the production packages file for status message
                    local host_list=""
                    if [[ -f "$main_json_file" ]]; then
                        host_list=$(jq -r '.hosts[]?.hostname // empty' "$main_json_file" 2>/dev/null | head -10 | tr '\n' ', ' | sed 's/,$//')
                    fi
                    
                    # Create enhanced status message
                    local status_message
                    if [[ "$packages_count" -eq 0 ]]; then
                        if [[ -n "$host_list" ]]; then
                            status_message="No packages were installed on: $host_list"
                        else
                            status_message="No packages were installed on any hosts"
                        fi
                    else
                        status_message="Found $packages_count package(s) installed on target date $target_date"
                    fi
                    
                    # Parse dispatcher information into structured data
                    local dispatcher_details='{}'
                    if [[ -n "$dispatcher_info" ]]; then
                        # Use Python to parse dispatcher info into structured JSON
                        dispatcher_details=$(python3 -c "
import json
import sys

dispatcher_info = '''$dispatcher_info'''

# Parse dispatcher information
dispatcher_data = {}
current_host = None
file_list = []

lines = dispatcher_info.split('\n')
for line in lines:
    line = line.strip()
    
    # Extract dispatcher hostnames from [INFO]: lines
    if line.startswith('[INFO]:'):
        hostname = line.replace('[INFO]:', '').strip()
        if hostname and hostname not in dispatcher_data:
            dispatcher_data[hostname] = []
    
    # Extract dispatcher hostnames and their modified files
    elif 'MODIFIED FILES FOUND ON:' in line:
        if current_host and file_list:
            dispatcher_data[current_host] = file_list
        current_host = line.split('MODIFIED FILES FOUND ON:')[1].strip()
        # Clean up any extra characters
        current_host = current_host.replace(' ===', '').strip()
        if current_host not in dispatcher_data:
            dispatcher_data[current_host] = []
        file_list = []
    elif line.startswith('/') and current_host:
        file_list.append(line)

# Add the last host if present
if current_host and file_list:
    dispatcher_data[current_host] = file_list

print(json.dumps(dispatcher_data, indent=2))
" 2>/dev/null || echo '{}')
                    fi
                    
                    # Update the main JSON with enhanced information
                    local enhanced_temp_file="/tmp/enhanced_main_$$.json"
                    local total_modified_files=$(echo "$dispatcher_details" | jq '[.[] | length] | add // 0' 2>/dev/null || echo '0')
                    jq \
                    --arg status_message "$status_message" \
                    --argjson packages_count "$packages_count" \
                    --argjson dispatcher_details "$dispatcher_details" \
                    --arg target_date "$target_date" \
                    --arg timestamp "$(date -Iseconds)" \
                    --argjson total_modified_files "$total_modified_files" \
                    '
                    . + {
                        "status_message": $status_message,
                        "summary": {
                            "total_packages": $packages_count,
                            "total_dispatchers_checked": ($dispatcher_details | keys | length),
                            "total_modified_files": $total_modified_files
                        },
                        "dispatcher_details": $dispatcher_details
                    }' "$main_json_file" > "$enhanced_temp_file"
                    mv "$enhanced_temp_file" "$main_json_file"
                    log "✓ Main JSON enhanced with improved status message and structured dispatcher details"
                fi
                
                # Display dispatcher info to console
                echo ""
                echo "$dispatcher_info"
                echo ""
            else
                log "ℹ Dispatcher monitoring completed (no deployment detected or no dispatcher hosts)"
            fi
        
        # Fetch change requests from ServiceNow (reuse early JSON if present)
        local company_name
        if company_name=$(get_company_name "$customer"); then
            local change_requests_file="$output_dir/${customer}-change-requests.json"
            local python_script="./now_get_cloud_manager_changes_custname.py"
            
            if [[ -f "$python_script" ]]; then
                # If early step didn't create JSON, run it now; otherwise reuse
                if [[ ! -s "$change_requests_file" ]]; then
                    log "Running change requests script for company: $company_name"
                    python3 "$python_script" -c "$company_name" -d "$target_date" > "$change_requests_file" 2>/dev/null || true
                else
                    log "DEBUG: Reusing existing change requests JSON: $change_requests_file"
                fi

                # Display change requests summary
                local change_count
                change_count=$(python3 -c "import json; data=json.load(open('$change_requests_file')); print(len(data))" 2>/dev/null || echo "0")
                echo "Found $change_count change requests for $company_name on $target_date"
                if [[ "$change_count" -gt 0 ]]; then
                    echo "Change request numbers:"
                    python3 -c "import json; data=json.load(open('$change_requests_file')); [print(f'  - {item.get(\"number\", \"N/A\")}: {item.get(\"short_description\", \"No description\")}') for item in data[:5]]" 2>/dev/null || echo "  (Unable to parse change requests)"
                    if [[ "$change_count" -gt 5 ]]; then
                        echo "  ... and $((change_count - 5)) more"
                    fi
                fi

                # Append change requests to main JSON
                if [[ -f "$main_json_file" ]]; then
                    local temp_file="/tmp/change_requests_temp_$$.json"
                    
                    # Read the change requests JSON and add it to the main file
                    if [[ -s "$change_requests_file" ]]; then
                        local change_requests_data=$(cat "$change_requests_file")
                        jq --argjson change_requests "$change_requests_data" \
                           --arg company "$company_name" \
                           --arg change_count "$change_count" \
                           '.change_requests = {
                               "company": $company,
                               "date": "'$target_date'",
                               "count": ($change_count | tonumber),
                               "requests": $change_requests
                           }' "$main_json_file" > "$temp_file"
                        mv "$temp_file" "$main_json_file"
                        log "✓ Change requests information appended to main JSON"
                    fi
                fi
            else
                log "WARNING: now_get_cloud_manager_changes_custname.py not found in current directory"
                echo "Change requests script not available"
            fi
        else
            log "WARNING: Could not extract company name, skipping change requests fetch"
            echo "Change requests not available (company name extraction failed)"
        fi
}

# Run main function with all arguments
main "$@"
