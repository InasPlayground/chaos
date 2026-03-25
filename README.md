# Rosetta Incident Extractor

A standalone script to extract incidents from the last 24 or 48 hours for a given customer from the Rosetta system.

## Features

- ✅ Extract incidents by customer ID
- ⏰ Configurable time window (24h or 48h)
- 📊 Multiple output formats (table, JSON, CSV)
- 🔍 Filter/exclude specific alert types
- 💾 Auto-save results to files
- 📈 Detailed statistics and summaries

## Prerequisites

- Node.js 18+ installed
- AWS credentials with access to DynamoDB
- Access to the `RosettaAlerts` DynamoDB table

## Installation

1. Navigate to the `incident-extractor` directory:

   ```bash
   cd incident-extractor
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Configure credentials:

   ```bash
   cp .env.example .env
   ```

4. Edit `.env` file with your credentials:

   ```env
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_access_key_here
   AWS_SECRET_ACCESS_KEY=your_secret_key_here
   ROSETTA_ALERTS_TABLE=RosettaAlerts
   ```

   **Alternative:** Use AWS profile instead:

   ```env
   AWS_REGION=us-east-1
   AWS_PROFILE=your_profile_name
   ```

## Usage

### Basic Usage

```bash
node extract-incidents.mjs --customer "Customer_Name"
```

### Specify Time Window

```bash
# Last 24 hours (default)
node extract-incidents.mjs --customer "Adobe_Marketing_Cloud" --hours 24

# Last 48 hours
node extract-incidents.mjs --customer "AEM_Sites" --hours 48
```

### Different Output Formats

```bash
# Table format (default, console output)
node extract-incidents.mjs --customer "Customer_Name" --output table

# JSON format (also saves to file)
node extract-incidents.mjs --customer "Customer_Name" --output json

# CSV format (also saves to file)
node extract-incidents.mjs --customer "Customer_Name" --output csv
```

### Exclude Specific Alert Types

```bash
node extract-incidents.mjs --customer "Customer_Name" --exclude "Load_Alert,CPU_Alert,Memory_Alert"
```

### Verbose Mode

```bash
node extract-incidents.mjs --customer "Customer_Name" --verbose
```

### Combined Example

```bash
node extract-incidents.mjs \
  --customer "Experience_Manager" \
  --hours 48 \
  --output json \
  --exclude "Test_Alert" \
  --verbose
```

## Command Line Options

| Option       | Short | Description                            | Default |
| ------------ | ----- | -------------------------------------- | ------- |
| `--customer` | `-c`  | Customer ID or name (required)         | -       |
| `--hours`    | `-h`  | Time window: 24 or 48 hours            | 24      |
| `--output`   | `-o`  | Output format: table, json, csv        | table   |
| `--exclude`  | `-e`  | Comma-separated alert names to exclude | -       |
| `--verbose`  | `-v`  | Enable verbose logging                 | false   |
| `--help`     | -     | Show help message                      | -       |

## Output Examples

### Table Format

```
┌────────────────────┬─────────────────────────┬───────────────────┬────────┬───────────────┬──────────────────┬──────────┐
│ Incident ID        │ Alert Name              │ Timestamp         │ Status │ Topology      │ IP/Host          │ Severity │
├────────────────────┼─────────────────────────┼───────────────────┼────────┼───────────────┼──────────────────┼──────────┤
│ INC123456          │ CPU_Overload            │ 2026-02-25T10:30  │ OPEN   │ prod-author   │ 10.20.30.40      │ High     │
│ INC123457          │ Memory_Leak             │ 2026-02-25T09:15  │ CLOSED │ prod-publish  │ 10.20.30.41      │ Critical │
└────────────────────┴─────────────────────────┴───────────────────┴────────┴───────────────┴──────────────────┴──────────┘
```

### JSON Format

```json
[
  {
    "incident_id": "INC123456",
    "alert_name": "CPU_Overload",
    "parent_id": "N/A",
    "timestamp": 1708857000000,
    "timestamp_readable": "2026-02-25T10:30:00.000Z",
    "host_alert": "prod-author-01",
    "status": "OPEN",
    "customer_id": "Adobe_Marketing_Cloud",
    "topology": "prod-author",
    "ip": "10.20.30.40",
    "hostname": "prod-author-01.adobe.com",
    "severity": "High",
    "description": "CPU usage exceeded 90% threshold"
  }
]
```

### CSV Format

```csv
incident_id,alert_name,parent_id,timestamp,timestamp_readable,host_alert,status,customer_id,topology,ip,hostname,severity,description
INC123456,CPU_Overload,N/A,1708857000000,2026-02-25T10:30:00.000Z,prod-author-01,OPEN,Adobe_Marketing_Cloud,prod-author,10.20.30.40,prod-author-01.adobe.com,High,CPU usage exceeded 90% threshold
```

## NPM Scripts

```bash
# Quick shortcuts
npm run extract -- --customer "Customer_Name"
npm run extract:24h -- --customer "Customer_Name"
npm run extract:48h -- --customer "Customer_Name"
```

## Data Source

This script queries the **RosettaAlerts DynamoDB table** using the following:

- **Table:** `RosettaAlerts`
- **Index:** `CustomerId-ExpiryTime-index`
- **Query:** Incidents where `CustomerId = <customer>` AND `ExpiryTime > <current_time - time_window>`

### DynamoDB Table Schema

The script accesses these fields from the RosettaAlerts table:

- `Incident_Id` - Unique incident identifier
- `AlertName` - Type of alert
- `Parent_Id` - Parent incident (for hierarchical incidents)
- `StartTime` - Timestamp when incident occurred
- `HostAlert` - Host information
- `STATUS` - Current incident status
- `CustomerId` - Customer identifier
- `AlertDetails` - JSON object with additional details (topology, IP, hostname, severity, etc.)
- `ExpiryTime` - Time-to-live field used for time-based queries

## Troubleshooting

### Authentication Errors

If you get authentication errors:

1. Verify your AWS credentials in `.env`
2. Check that your IAM user/role has DynamoDB read permissions
3. Ensure the region is correct

### No Results Found

If no incidents are returned:

1. Verify the customer ID is correct (case-sensitive)
2. Check if incidents exist in the specified time window
3. Use `--verbose` flag to see query details
4. Verify table name in `.env` is correct

### Permission Errors

Required IAM permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["dynamodb:Query", "dynamodb:GetItem"],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:*:table/RosettaAlerts",
        "arn:aws:dynamodb:us-east-1:*:table/RosettaAlerts/index/*"
      ]
    }
  ]
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 Incident Extractor Script               │
│                                                         │
│  ┌──────────────┐      ┌─────────────────────────┐    │
│  │ CLI Parser   │ ───> │  DynamoDB Client        │    │
│  └──────────────┘      │  (AWS SDK v3)           │    │
│                        └─────────────────────────┘    │
│                                 │                       │
│                                 ▼                       │
│  ┌──────────────────────────────────────────────┐     │
│  │        Query RosettaAlerts Table             │     │
│  │   Index: CustomerId-ExpiryTime-index         │     │
│  └──────────────────────────────────────────────┘     │
│                                 │                       │
│                                 ▼                       │
│  ┌──────────────┐      ┌─────────────────────────┐    │
│  │ Filter &     │ ───> │  Format Output          │    │
│  │ Transform    │      │  (Table/JSON/CSV)       │    │
│  └──────────────┘      └─────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Files

- `extract-incidents.mjs` - Main extraction script
- `package.json` - Dependencies and npm scripts
- `.env.example` - Example environment configuration
- `.env` - Your actual credentials (git-ignored)
- `README.md` - This file

## License

Adobe Internal Use Only
