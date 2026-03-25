#!/bin/bash

# Script to extract the latest installed packages from the CSV output
# Usage: ./extract_latest_packages.sh [csv_file] [number_of_latest_packages]

set -euo pipefail

# Function to display usage
usage() {
    echo "Usage: $0 [csv_file] [number_of_latest_packages] [output_csv_file] [target_date]"
    echo "If no arguments provided, will use the latest CSV file and show top 10 packages"
    echo "Examples:"
    echo "  $0 my-customer-prod-packages-20240115-143025.csv 20"
    echo "  $0 my-customer-prod-packages-20240115-143025.csv 20 my-customer-packages.csv"
    echo "  $0 my-customer-prod-packages-20240115-143025.csv 20 my-customer-packages.csv 2022-03-02"
    exit 1
}

# Function to log messages with timestamp
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >&2
}

# Function to find the latest CSV file
find_latest_csv() {
    local latest_csv
    latest_csv=$(ls -t *-prod-packages-*.csv 2>/dev/null | head -n 1 || echo "")
    
    if [[ -z "$latest_csv" ]]; then
        log "ERROR: No CSV files found matching pattern '*-prod-packages-*.csv'"
        exit 1
    fi
    
    echo "$latest_csv"
}

# Function to extract and sort packages by install date
extract_latest_packages() {
    local csv_file=$1
    local num_packages=${2:-10}
    local output_csv=${3:-""}
    local target_date=${4:-""}
    
    log "Processing CSV file: $csv_file"
    log "Extracting top $num_packages latest packages"
    if [[ -n "$output_csv" ]]; then
        log "Results will be saved to: $output_csv"
    fi
    
    # Create temporary file for processing
    local temp_file
    temp_file=$(mktemp)
    
    # Extract package information from CSV and parse the structured data
    local parser_script="./parse_packages.py"
    if [[ ! -f "$parser_script" ]]; then
        log "ERROR: parse_packages.py not found in current directory"
        exit 1
    fi
    
    # Run the Python parser and save output to temp file
    log "Running Python parser..."
    if [[ -n "$target_date" ]]; then
        if ! python3 "$parser_script" "$csv_file" --date "$target_date" > "$temp_file"; then
            log "ERROR: Python parser failed"
            exit 1
        fi
    else
        if ! python3 "$parser_script" "$csv_file" --today-only > "$temp_file"; then
            log "ERROR: Python parser failed"
            exit 1
        fi
    fi
    
    local temp_lines
    temp_lines=$(wc -l < "$temp_file")
    log "Python parser generated $temp_lines lines"
    
    # Sort by install date (descending) and display the packages
    echo ""
    if [[ -n "$target_date" ]]; then
        echo "PACKAGES INSTALLED ON $target_date WITH VERSION HISTORY"
        echo "==============================================="
        echo "Date: $target_date"
    else
        echo "TODAY'S INSTALLED PACKAGES WITH VERSION HISTORY"
        echo "==============================================="
        echo "Date: $(date '+%Y-%m-%d')"
    fi
    echo ""
    
    # Sort by date (first column) in descending order and show packages
    if [[ -n "$target_date" ]]; then
        log "Sorting and showing packages from $target_date..."
    else
        log "Sorting and showing today's packages..."
    fi
    local sorted_output
    sorted_output=$(sort -t'|' -k1,1r "$temp_file")
    
    # Display to console
    log "Displaying results to console..."
    # Use a safer approach to display formatted output
    set +e  # Temporarily disable exit on error
    if command -v column >/dev/null 2>&1; then
        echo "$sorted_output" | column -t -s'|' 2>/dev/null || {
            log "WARNING: column command failed, showing raw output"
            echo "$sorted_output"
        }
    else
        echo "$sorted_output"
    fi
    set -e  # Re-enable exit on error
    
    # Save to CSV file if output_csv is specified
    if [[ -n "$output_csv" ]]; then
        log "Saving results to CSV file: $output_csv"
        # Convert pipe-separated output to CSV format
        echo "$sorted_output" | sed 's/|/,/g' > "$output_csv"
        if [[ -f "$output_csv" ]]; then
            log "CSV file saved successfully with $(wc -l < "$output_csv") lines"
        else
            log "ERROR: Failed to create CSV file"
        fi
    fi
    
    echo ""
    echo "Summary:"
    echo "--------"
    local total_packages
    total_packages=$(( $(wc -l < "$temp_file") - 2 ))  # Subtract header lines
    echo "Total packages found: $total_packages"
    echo "Showing: Today's packages only"
    echo ""
    
    # Count packages with version history
    local packages_with_history
    set +e  # Temporarily disable exit on error for counting
    packages_with_history=$(grep -v 'N/A$' "$temp_file" 2>/dev/null | grep -v '^Install_Date' 2>/dev/null | grep -v '^============' 2>/dev/null | wc -l | tr -d ' ')
    set -e  # Re-enable exit on error
    echo "Packages with version history: $packages_with_history"
    echo "Packages without prior versions: $((total_packages - packages_with_history))"
    echo ""
    
    # Show the date range
    local latest_date oldest_date
    set +e  # Temporarily disable exit on error for date extraction
    latest_date=$(sort -t'|' -k1,1r "$temp_file" | sed -n '3p' | cut -d'|' -f1 2>/dev/null)
    oldest_date=$(sort -t'|' -k1,1 "$temp_file" | sed -n '3p' | cut -d'|' -f1 2>/dev/null)
    set -e  # Re-enable exit on error
    
    if [[ -n "$latest_date" && -n "$oldest_date" ]]; then
        echo "Latest install date: $latest_date"
        echo "Oldest install date: $oldest_date"
    fi
    
    # Clean up
    rm -f "$temp_file"
}

# Main function
main() {
    local csv_file=""
    local num_packages=10
    local output_csv=""
    
    # Parse arguments
    if [[ $# -eq 0 ]]; then
        # No arguments - find latest CSV and use default number
        csv_file=$(find_latest_csv)
        log "No arguments provided. Using latest CSV file: $csv_file"
    elif [[ $# -eq 1 ]]; then
        # One argument - could be CSV file or number
        if [[ "$1" =~ ^[0-9]+$ ]]; then
            # It's a number
            num_packages=$1
            csv_file=$(find_latest_csv)
            log "Using latest CSV file: $csv_file, showing top $num_packages packages"
        else
            # It's a file name
            csv_file=$1
            if [[ ! -f "$csv_file" ]]; then
                log "ERROR: CSV file '$csv_file' not found"
                exit 1
            fi
        fi
    elif [[ $# -eq 2 ]]; then
        # Two arguments - CSV file and number
        csv_file=$1
        num_packages=$2
        
        if [[ ! -f "$csv_file" ]]; then
            log "ERROR: CSV file '$csv_file' not found"
            exit 1
        fi
        
        if [[ ! "$num_packages" =~ ^[0-9]+$ ]]; then
            log "ERROR: Number of packages must be a positive integer"
            exit 1
        fi
    elif [[ $# -eq 3 ]]; then
        # Three arguments - CSV file, number, and output CSV
        csv_file=$1
        num_packages=$2
        output_csv=$3
        
        if [[ ! -f "$csv_file" ]]; then
            log "ERROR: CSV file '$csv_file' not found"
            exit 1
        fi
        
        if [[ ! "$num_packages" =~ ^[0-9]+$ ]]; then
            log "ERROR: Number of packages must be a positive integer"
            exit 1
        fi
    elif [[ $# -eq 4 ]]; then
        # Four arguments - CSV file, number, output CSV, and target date
        csv_file=$1
        num_packages=$2
        output_csv=$3
        target_date=$4
        
        if [[ ! -f "$csv_file" ]]; then
            log "ERROR: CSV file '$csv_file' not found"
            exit 1
        fi
        
        if [[ ! "$num_packages" =~ ^[0-9]+$ ]]; then
            log "ERROR: Number of packages must be a positive integer"
            exit 1
        fi
    else
        usage
    fi
    
    # Extract and display latest packages
    extract_latest_packages "$csv_file" "$num_packages" "$output_csv" "$target_date"
}

# Run main function with all arguments
main "$@"
