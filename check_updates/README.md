# What it does:

Retrieves the modifications made on the hosts of an AMS topology
NOTE: Due to the AMS security restrictions, only CSE, CDE have access to the needed tools/environments

## Files Included

- `get_prod_packages_ams.sh` - Main script for package analysis
- `get_company_name.sh` - Helper script to extract company names
- `now_get_cloud_manager_changes_custname.py` - Script to fetch ServiceNow change requests
- `extract_latest_packages.sh` - Package extraction script

## Prerequisites

Before running the scripts, ensure you have:

1. **amstool** - AMS command-line tool installed and configured
2. **jq** - JSON processor tool (`brew install jq` on macOS)
3. **python3** - Python 3 with required modules
4. **Proper credentials** - MSCentral, ServiceNow, AMS network access

## Usage

./get_prod_packages_ams.sh <customer> [--minutes N | --hour N | --hours N | --days N]

Examples:

# Analyze packages for the last 24 hours (default)

./get_prod_packages_ams.sh barcelo-stage-65

# Analyze packages for the last 90 minutes

./get_prod_packages_ams.sh barcelo-stage-65 --minutes 90

# Analyze packages for the last 6 hours

./get_prod_packages_ams.sh barcelo-stage-65 --hours 6

# Analyze packages for the last 3 days

./get_prod_packages_ams.sh aafes-prod-1 --days 3

```

## Output

The script creates a directory named `<customer>_<date>` containing:

- `<customer>.json` - Main JSON file with all data
- `<customer>-prod-packages-*.json` - Raw package data
- `<customer>-dispatcher-info-*.txt` - Dispatcher monitoring results
- `<customer>-change-requests.json` - ServiceNow change requests (if available)



```
