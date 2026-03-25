#!/usr/bin/env python3
"""
Minimal script to fetch "Cloud Manager" change requests for a company
from ServiceNow. Authenticates against the configured instance using basic auth.

- Requires company name as command-line argument
- Optional closed date filtering (YYYY-MM-DD format) via --date argument
- If no date provided, uses SN_DAYS from environment (defaults to 60 days)
- Runs a single STARTSWITH short_description query
- Includes customer name in the output
- Prints the search criteria (to stderr) before outputting JSON results (to stdout)
"""

import json
import sys
from typing import Any, Dict, List
from datetime import datetime, timedelta

import requests
import os
import argparse

# Load environment from .env if available
try:
    from dotenv import load_dotenv  # type: ignore

    load_dotenv()
except Exception:
    pass


# === PARAMS (loaded from environment/.env with defaults) ===
INSTANCE = os.getenv("SN_INSTANCE", "adobems")  # e.g., "adobems" or "adobedev"
USER = os.getenv("SN_USER", "")
PASSWORD = os.getenv("SN_PASS", "")
COMPANY_SYS_ID = os.getenv("SN_COMPANY_SYS_ID", "")  # e.g., "e516e7a6db1f2b402ec79a82ca9619c1"
DAYS = int(os.getenv("SN_DAYS", "60"))  # look back window in days
TIMEOUT_SECONDS = int(os.getenv("SN_TIMEOUT_SECONDS", "30"))
# ==========================================================


def build_servicenow_url(instance: str) -> str:
    instance = (instance or "").strip().replace("https://", "").replace("http://", "")
    instance = instance.split(".")[0] if instance else "adobems"
    return f"https://{instance}.service-now.com/api/now/table/change_request"


def fetch_cloud_manager_changes(
    instance: str,
    user: str,
    password: str,
    company_name: str,
    days: int,
    timeout_seconds: int,
    closed_date: str = None,
) -> Dict[str, Any]:
    base_url = build_servicenow_url(instance)

    if closed_date:
        # Use specific closed date - filter for tickets closed exactly on that date
        # ServiceNow date format: YYYY-MM-DD HH:MM:SS
        start_of_day = f"{closed_date} 00:00:00"
        end_of_day = f"{closed_date} 23:59:59"
        sysparm_query = (
            f"company.name={company_name}^"
            f"closed_at>={start_of_day}^"
            f"closed_at<={end_of_day}^"
            f"short_descriptionSTARTSWITHCloud Manager"
        )
    else:
        # Use days-based filtering on created date
        sysparm_query = (
            f"company.name={company_name}^"
            f"short_descriptionSTARTSWITHCloud Manager"
        )
    sysparm_fields = "sys_id,number,short_description,created_on,closed_at,state,company.name"

    params = {
        "sysparm_query": sysparm_query,
        "sysparm_fields": sysparm_fields,
        "sysparm_orderby": "created_on",
    }

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    response = requests.get(
        base_url,
        headers=headers,
        params=params,
        auth=(user, password),
        timeout=timeout_seconds,
    )
    response.raise_for_status()
    data = response.json()

    # Prepare metadata and results
    result = data.get("result", [])
    if not isinstance(result, list):
        raise ValueError("Unexpected response format: 'result' is not a list")

    # Defensive client-side sort by created_on (ascending)
    try:
        result.sort(key=lambda r: (r or {}).get("created_on") or "")
    except Exception:
        pass

    meta = {
        "instance": instance,
        "company_name": company_name,
        "days": days if not closed_date else None,
        "closed_date": closed_date,
        "mode": "STARTSWITH",
        "query": sysparm_query,
    }
    return {"meta": meta, "result": result}


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch Cloud Manager change requests (STARTSWITH filter).")
    parser.add_argument("-c", "--company-name", dest="company_name", required=True, help="ServiceNow company name")
    parser.add_argument("-d", "--date", dest="closed_date", help="Closed date for filtering (YYYY-MM-DD format). If not provided, uses SN_DAYS from environment.")
    args = parser.parse_args()

    company_name = args.company_name
    closed_date = args.closed_date

    # Validate date format if provided
    if closed_date:
        try:
            datetime.strptime(closed_date, "%Y-%m-%d")
        except ValueError:
            print(f"Invalid date format: {closed_date}. Please use YYYY-MM-DD format.", file=sys.stderr)
            return 2

    if not USER or not PASSWORD:
        print(
            "Please set SN_USER and SN_PASS in environment variables or .env file.",
            file=sys.stderr,
        )
        return 2

    data = fetch_cloud_manager_changes(
        instance=INSTANCE,
        user=USER,
        password=PASSWORD,
        company_name=company_name,
        days=DAYS,
        timeout_seconds=TIMEOUT_SECONDS,
        closed_date=closed_date,
    )

    meta = data["meta"]
    # Print criteria to stderr (keeps stdout as clean JSON for piping)
    sys.stderr.write("Search criteria used:\n")
    sys.stderr.write(f"  Instance: {meta.get('instance')}\n")
    sys.stderr.write(f"  Company name: {meta.get('company_name')}\n")
    if meta.get('closed_date'):
        sys.stderr.write(f"  Closed date: {meta.get('closed_date')}\n")
    else:
        sys.stderr.write(f"  Days: {meta.get('days')}\n")
    sys.stderr.write(f"  Mode: {meta.get('mode')}\n")
    sys.stderr.write(f"  sysparm_query: {meta.get('query')}\n")

    # Print results as JSON to stdout
    print(json.dumps(data["result"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


