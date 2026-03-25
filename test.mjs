#!/usr/bin/env node

/**
 * Rosetta Incident Extractor
 * 
 * Standalone script to extract incidents from the last X minutes for a given customer.
 * 
 * Usage:
 *   node extract-incidents.mjs --customer-id <customer_id> [--minutes <number>] [--output <json|csv|table>]
 * 
 * Examples:
 *   node extract-incidents.mjs --customer-id "Adobe_Marketing_Cloud" --minutes 30
 *   node extract-incidents.mjs --customer-id "AEM_Sites" --minutes 120 --output csv
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { config } from 'dotenv';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const ROSETTA_ALERTS_TABLE = process.env.ROSETTA_ALERTS_TABLE || 'RosettaAlerts';

// Initialize DynamoDB client
let clientConfig = {
    region: AWS_REGION,
};

// Use explicit credentials if provided
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
} else if (process.env.AWS_PROFILE) {
    // Let SDK use the profile from ~/.aws/config or AWS_PROFILE env variable
    clientConfig = {
        region: AWS_REGION,
        // The SDK will automatically load from the profile
    };
}

const dynamoDBClient = new DynamoDBClient(clientConfig);

const docClient = DynamoDBDocumentClient.from(dynamoDBClient);

/**
 * Parse command line arguments
 */
function parseArguments() {
    const args = process.argv.slice(2);
    const params = {
        customerId: null,
        topology: null,
        minutes: 24 * 60,
        output: 'table', // table, json, csv
        excludeAlertNames: [],
        allCustomers: false,
        verbose: false
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--customer':
            case '--customer-id':
            case '-c':
                params.customerId = args[++i];
                break;
            case '--topology':
            case '-t':
                params.topology = args[++i];
                break;
            case '--hours':
            case '-h':
                params.minutes = parseInt(args[++i]) * 60;
                break;
            case '--minutes':
            case '-m':
                params.minutes = parseInt(args[++i]);
                break;
            case '--output':
            case '-o':
                params.output = args[++i];
                break;
            case '--exclude':
            case '-e':
                params.excludeAlertNames = args[++i].split(',').map(s => s.trim());
                break;
            case '--all':
                params.allCustomers = true;
                break;
            case '--verbose':
            case '-v':
                params.verbose = true;
                break;
            case '--help':
                printHelp();
                process.exit(0);
            default:
                if (!params.customerId && !args[i].startsWith('--')) {
                    params.customerId = args[i];
                }
        }
    }

    return params;
}

/**
 * Print help message
 */
function printHelp() {
    console.log(`
Rosetta Incident Extractor
==========================

Extract incidents from the last X minutes for a given customer.

Usage:
  node extract-incidents.mjs --customer <customer_id> [options]

Options:
  -c, --customer-id <id>     Customer ID (required unless --all or --topology)
  -t, --topology <name>      Topology name (alternative to customer ID)
    -h, --hours <number>       Time window in hours (deprecated; converts to minutes)
  -o, --output <format>      Output format: table, json, csv (default: table)
  -e, --exclude <names>      Comma-separated alert names to exclude
    --all                      Fetch incidents for all customers (uses DynamoDB Scan)
  -v, --verbose              Enable verbose logging
  --help                     Show this help message

Examples:
    node extract-incidents.mjs --customer-id "Adobe_Marketing_Cloud" --minutes 30
    node extract-incidents.mjs --customer-id "AEM_Sites" --minutes 120 --output json
    node extract-incidents.mjs -c "Experience_Manager" -m 90 -o csv --exclude "Load_Alert,CPU_Alert"
  node extract-incidents.mjs --topology "prod-author" --minutes 60
  AWS_ACCESS_KEY_ID          AWS access key
  AWS_SECRET_ACCESS_KEY      AWS secret key
  AWS_PROFILE                AWS profile name (alternative to keys)
  ROSETTA_ALERTS_TABLE       DynamoDB table name (default: RosettaAlerts)
`);
}

/**
 * Query DynamoDB for incidents in the specified time window
 */
async function extractIncidents(customerId, timeWindowMinutes, excludeAlertNames = [], verbose = false) {
    const currentTime = Date.now();
    const timeWindowInSeconds = timeWindowMinutes * 60; // Convert minutes to seconds
    const filterTimeInMilliseconds = currentTime - (timeWindowInSeconds * 1000);

    if (verbose) {
        console.log(`\n🔍 Query Parameters:`);
        console.log(`   Customer ID: ${customerId}`);
        console.log(`   Time Window: ${timeWindowMinutes} minutes (${timeWindowInSeconds} seconds)`);
        console.log(`   Filter Time: ${new Date(filterTimeInMilliseconds).toISOString()}`);
        console.log(`   Current Time: ${new Date(currentTime).toISOString()}`);
        console.log(`   Table: ${ROSETTA_ALERTS_TABLE}`);
        console.log(`   Index: CustomerId-ExpiryTime-index\n`);
    }

    const queryParams = {
        TableName: ROSETTA_ALERTS_TABLE,
        IndexName: 'CustomerId-ExpiryTime-index',
        KeyConditionExpression: 'CustomerId = :customerId AND ExpiryTime > :filterTimeInMilliseconds',
        ExpressionAttributeValues: {
            ':customerId': customerId,
            ':filterTimeInMilliseconds': filterTimeInMilliseconds,
        },
    };

    try {
        console.log(`⏳ Querying ${ROSETTA_ALERTS_TABLE} for incidents...`);
        
        const command = new QueryCommand(queryParams);
        const queryResult = await docClient.send(command);
        let alerts = queryResult.Items || [];

        if (verbose) {
            console.log(`✅ Retrieved ${alerts.length} alerts from DynamoDB\n`);
        }

        // Filter out excluded alert names if provided
        if (excludeAlertNames && excludeAlertNames.length > 0) {
            const beforeFilter = alerts.length;
            alerts = alerts.filter(alert => !excludeAlertNames.includes(alert.AlertName));
            
            if (verbose) {
                console.log(`🔧 Filtered out ${beforeFilter - alerts.length} alerts matching exclusion list`);
                console.log(`   Remaining: ${alerts.length}\n`);
            }
        }

        // Map to cleaner response format
        const incidentsList = alerts.map(alert => {
            let alertDetails = {};
            try {
                if (typeof alert.AlertDetails === 'string') {
                    alertDetails = JSON.parse(alert.AlertDetails);
                } else if (alert.AlertDetails) {
                    alertDetails = alert.AlertDetails;
                }
            } catch (e) {
                // Keep as is if parsing fails
                alertDetails = alert.AlertDetails || {};
            }

            return {
                incident_id: alert.Incident_Id || 'N/A',
                alert_name: alert.AlertName || 'N/A',
                parent_id: alert.Parent_Id || 'N/A',
                timestamp: alert.StartTime || 'N/A',
                timestamp_readable: alert.StartTime ? new Date(alert.StartTime).toISOString() : 'N/A',
                host_alert: alert.HostAlert || 'N/A',
                status: alert.STATUS || 'N/A',
                customer_id: alert.CustomerId || customerId,
                topology: alertDetails.topology || 'N/A',
                ip: alertDetails.ip || 'N/A',
                hostname: alertDetails.hostname || 'N/A',
                severity: alertDetails.severity || 'N/A',
                description: alertDetails.description || 'N/A'
            };
        });

        // Sort by timestamp (most recent first)
        incidentsList.sort((a, b) => {
            const timeA = typeof a.timestamp === 'number' ? a.timestamp : 0;
            const timeB = typeof b.timestamp === 'number' ? b.timestamp : 0;
            return timeB - timeA;
        });

        return incidentsList;

    } catch (error) {
        console.error('❌ Error querying DynamoDB:', error);
        throw error;
    }
}

/**
 * Scan DynamoDB for incidents across all customers in the specified time window
 */
async function extractAllIncidents(timeWindowMinutes, excludeAlertNames = [], verbose = false) {
    const currentTime = Date.now();
    const timeWindowInSeconds = timeWindowMinutes * 60; // Convert minutes to seconds
    const filterTimeInMilliseconds = currentTime - (timeWindowInSeconds * 1000);

    if (verbose) {
        console.log(`\n🔍 Query Parameters:`);
        console.log(`   Customer ID: ALL`);
        console.log(`   Time Window: ${timeWindowMinutes} minutes (${timeWindowInSeconds} seconds)`);
        console.log(`   Filter Time: ${new Date(filterTimeInMilliseconds).toISOString()}`);
        console.log(`   Current Time: ${new Date(currentTime).toISOString()}`);
        console.log(`   Table: ${ROSETTA_ALERTS_TABLE}`);
        console.log(`   Mode: Scan (no customer filter)\n`);
    }

    try {
        console.log(`⏳ Scanning ${ROSETTA_ALERTS_TABLE} for incidents (all customers)...`);

        let items = [];
        let lastEvaluatedKey = undefined;

        do {
            const scanParams = {
                TableName: ROSETTA_ALERTS_TABLE,
                FilterExpression: 'ExpiryTime > :filterTimeInMilliseconds',
                ExpressionAttributeValues: {
                    ':filterTimeInMilliseconds': filterTimeInMilliseconds,
                },
                ExclusiveStartKey: lastEvaluatedKey
            };

            const command = new ScanCommand(scanParams);
            const response = await docClient.send(command);
            items = items.concat(response.Items || []);
            lastEvaluatedKey = response.LastEvaluatedKey;

            if (verbose) {
                console.log(`   Retrieved ${items.length} items so far...`);
            }
        } while (lastEvaluatedKey);

        let alerts = items;

        if (verbose) {
            console.log(`✅ Retrieved ${alerts.length} alerts from DynamoDB\n`);
        }

        // Filter out excluded alert names if provided
        if (excludeAlertNames && excludeAlertNames.length > 0) {
            const beforeFilter = alerts.length;
            alerts = alerts.filter(alert => !excludeAlertNames.includes(alert.AlertName));

            if (verbose) {
                console.log(`🔧 Filtered out ${beforeFilter - alerts.length} alerts matching exclusion list`);
                console.log(`   Remaining: ${alerts.length}\n`);
            }
        }

        const incidentsList = alerts.map(alert => {
            let alertDetails = {};
            try {
                if (typeof alert.AlertDetails === 'string') {
                    alertDetails = JSON.parse(alert.AlertDetails);
                } else if (alert.AlertDetails) {
                    alertDetails = alert.AlertDetails;
                }
            } catch (e) {
                alertDetails = alert.AlertDetails || {};
            }

            return {
                incident_id: alert.Incident_Id || 'N/A',
                alert_name: alert.AlertName || 'N/A',
                parent_id: alert.Parent_Id || 'N/A',
                timestamp: alert.StartTime || 'N/A',
                timestamp_readable: alert.StartTime ? new Date(alert.StartTime).toISOString() : 'N/A',
                host_alert: alert.HostAlert || 'N/A',
                status: alert.STATUS || 'N/A',
                customer_id: alert.CustomerId || 'N/A',
                topology: alertDetails.topology || 'N/A',
                ip: alertDetails.ip || 'N/A',
                hostname: alertDetails.hostname || 'N/A',
                severity: alertDetails.severity || 'N/A',
                description: alertDetails.description || 'N/A'
            };
        });

        incidentsList.sort((a, b) => {
            const timeA = typeof a.timestamp === 'number' ? a.timestamp : 0;
            const timeB = typeof b.timestamp === 'number' ? b.timestamp : 0;
            return timeB - timeA;
        });

        return incidentsList;
    } catch (error) {
        console.error('❌ Error scanning DynamoDB:', error);
        throw error;
    }
}

/**
 * Scan DynamoDB for incidents by topology in the specified time window
 */
async function extractIncidentsByTopology(topology, timeWindowMinutes, excludeAlertNames = [], verbose = false) {
    const currentTime = Date.now();
    const timeWindowInSeconds = timeWindowMinutes * 60;
    const filterTimeInMilliseconds = currentTime - (timeWindowInSeconds * 1000);

    if (verbose) {
        console.log(`\n🔍 Query Parameters:`);
        console.log(`   Topology: ${topology}`);
        console.log(`   Time Window: ${timeWindowMinutes} minutes (${timeWindowInSeconds} seconds)`);
        console.log(`   Filter Time: ${new Date(filterTimeInMilliseconds).toISOString()}`);
        console.log(`   Current Time: ${new Date(currentTime).toISOString()}`);
        console.log(`   Table: ${ROSETTA_ALERTS_TABLE}`);
        console.log(`   Mode: Scan (filtering by topology in AlertDetails)\n`);
    }

    try {
        console.log(`⏳ Scanning ${ROSETTA_ALERTS_TABLE} for incidents with topology: ${topology}...`);

        let items = [];
        let lastEvaluatedKey = undefined;

        do {
            const scanParams = {
                TableName: ROSETTA_ALERTS_TABLE,
                FilterExpression: 'ExpiryTime > :filterTimeInMilliseconds',
                ExpressionAttributeValues: {
                    ':filterTimeInMilliseconds': filterTimeInMilliseconds,
                },
                ExclusiveStartKey: lastEvaluatedKey
            };

            const command = new ScanCommand(scanParams);
            const response = await docClient.send(command);
            items = items.concat(response.Items || []);
            lastEvaluatedKey = response.LastEvaluatedKey;

            if (verbose) {
                console.log(`   Retrieved ${items.length} items so far...`);
            }
        } while (lastEvaluatedKey);

        let alerts = items;

        if (verbose) {
            console.log(`✅ Retrieved ${alerts.length} alerts from DynamoDB\n`);
        }

        // Filter by topology (topology is stored in AlertDetails JSON)
        alerts = alerts.filter(alert => {
            let alertDetails = {};
            try {
                if (typeof alert.AlertDetails === 'string') {
                    alertDetails = JSON.parse(alert.AlertDetails);
                } else if (alert.AlertDetails) {
                    alertDetails = alert.AlertDetails;
                }
            } catch (e) {
                return false;
            }
            return alertDetails.topology === topology;
        });

        if (verbose) {
            console.log(`🔧 Filtered to ${alerts.length} alerts matching topology: ${topology}\n`);
        }

        // Filter out excluded alert names if provided
        if (excludeAlertNames && excludeAlertNames.length > 0) {
            const beforeFilter = alerts.length;
            alerts = alerts.filter(alert => !excludeAlertNames.includes(alert.AlertName));

            if (verbose) {
                console.log(`🔧 Filtered out ${beforeFilter - alerts.length} alerts matching exclusion list`);
                console.log(`   Remaining: ${alerts.length}\n`);
            }
        }

        const incidentsList = alerts.map(alert => {
            let alertDetails = {};
            try {
                if (typeof alert.AlertDetails === 'string') {
                    alertDetails = JSON.parse(alert.AlertDetails);
                } else if (alert.AlertDetails) {
                    alertDetails = alert.AlertDetails;
                }
            } catch (e) {
                alertDetails = alert.AlertDetails || {};
            }

            return {
                incident_id: alert.Incident_Id || 'N/A',
                alert_name: alert.AlertName || 'N/A',
                parent_id: alert.Parent_Id || 'N/A',
                timestamp: alert.StartTime || 'N/A',
                timestamp_readable: alert.StartTime ? new Date(alert.StartTime).toISOString() : 'N/A',
                host_alert: alert.HostAlert || 'N/A',
                status: alert.STATUS || 'N/A',
                customer_id: alert.CustomerId || 'N/A',
                topology: alertDetails.topology || 'N/A',
                ip: alertDetails.ip || 'N/A',
                hostname: alertDetails.hostname || 'N/A',
                severity: alertDetails.severity || 'N/A',
                description: alertDetails.description || 'N/A'
            };
        });

        incidentsList.sort((a, b) => {
            const timeA = typeof a.timestamp === 'number' ? a.timestamp : 0;
            const timeB = typeof b.timestamp === 'number' ? b.timestamp : 0;
            return timeB - timeA;
        });

        return incidentsList;
    } catch (error) {
        console.error('❌ Error scanning DynamoDB:', error);
        throw error;
    }
}", "oldString": "/**\n * Scan DynamoDB for incidents across all customers in the specified time window\n */\nasync function extractAllIncidents(timeWindowMinutes, excludeAlertNames = [], verbose = false) {\n    const currentTime = Date.now();\n    const timeWindowInSeconds = timeWindowMinutes * 60; // Convert minutes to seconds\n    const filterTimeInMilliseconds = currentTime - (timeWindowInSeconds * 1000);\n\n    if (verbose) {\n        console.log(`\\n🔍 Query Parameters:`);\n        console.log(`   Customer ID: ALL`);\n        console.log(`   Time Window: ${timeWindowMinutes} minutes (${timeWindowInSeconds} seconds)`);\n        console.log(`   Filter Time: ${new Date(filterTimeInMilliseconds).toISOString()}`);\n        console.log(`   Current Time: ${new Date(currentTime).toISOString()}`);\n        console.log(`   Table: ${ROSETTA_ALERTS_TABLE}`);\n        console.log(`   Mode: Scan (no customer filter)\\n`);\n    }\n\n    try {\n        console.log(`⏳ Scanning ${ROSETTA_ALERTS_TABLE} for incidents (all customers)...`);\n\n        let items = [];\n        let lastEvaluatedKey = undefined;\n\n        do {\n            const scanParams = {\n                TableName: ROSETTA_ALERTS_TABLE,\n                FilterExpression: 'ExpiryTime > :filterTimeInMilliseconds',\n                ExpressionAttributeValues: {\n                    ':filterTimeInMilliseconds': filterTimeInMilliseconds,\n                },\n                ExclusiveStartKey: lastEvaluatedKey\n            };\n\n            const command = new ScanCommand(scanParams);\n            const response = await docClient.send(command);\n            items = items.concat(response.Items || []);\n            lastEvaluatedKey = response.LastEvaluatedKey;\n\n            if (verbose) {\n                console.log(`   Retrieved ${items.length} items so far...`);\n            }\n        } while (lastEvaluatedKey);\n\n        let alerts = items;\n\n        if (verbose) {\n            console.log(`✅ Retrieved ${alerts.length} alerts from DynamoDB\\n`);\n        }\n\n        // Filter out excluded alert names if provided\n        if (excludeAlertNames && excludeAlertNames.length > 0) {\n            const beforeFilter = alerts.length;\n            alerts = alerts.filter(alert => !excludeAlertNames.includes(alert.AlertName));\n\n            if (verbose) {\n                console.log(`🔧 Filtered out ${beforeFilter - alerts.length} alerts matching exclusion list`);\n                console.log(`   Remaining: ${alerts.length}\\n`);\n            }\n        }\n\n        const incidentsList = alerts.map(alert => {\n            let alertDetails = {};\n            try {\n                if (typeof alert.AlertDetails === 'string') {\n                    alertDetails = JSON.parse(alert.AlertDetails);\n                } else if (alert.AlertDetails) {\n                    alertDetails = alert.AlertDetails;\n                }\n            } catch (e) {\n                alertDetails = alert.AlertDetails || {};\n            }\n\n            return {\n                incident_id: alert.Incident_Id || 'N/A',\n                alert_name: alert.AlertName || 'N/A',\n                parent_id: alert.Parent_Id || 'N/A',\n                timestamp: alert.StartTime || 'N/A',\n                timestamp_readable: alert.StartTime ? new Date(alert.StartTime).toISOString() : 'N/A',\n                host_alert: alert.HostAlert || 'N/A',\n                status: alert.STATUS || 'N/A',\n                customer_id: alert.CustomerId || 'N/A',\n                topology: alertDetails.topology || 'N/A',\n                ip: alertDetails.ip || 'N/A',\n                hostname: alertDetails.hostname || 'N/A',\n                severity: alertDetails.severity || 'N/A',\n                description: alertDetails.description || 'N/A'\n            };\n        });\n\n        incidentsList.sort((a, b) => {\n            const timeA = typeof a.timestamp === 'number' ? a.timestamp : 0;\n            const timeB = typeof b.timestamp === 'number' ? b.timestamp : 0;\n            return timeB - timeA;\n        });\n\n        return incidentsList;\n    } catch (error) {\n        console.error('❌ Error scanning DynamoDB:', error);\n        throw error;\n    }\n}
async function extractAllIncidents(timeWindowMinutes, excludeAlertNames = [], verbose = false) {
    const currentTime = Date.now();
    const timeWindowInSeconds = timeWindowMinutes * 60; // Convert minutes to seconds
    const filterTimeInMilliseconds = currentTime - (timeWindowInSeconds * 1000);

    if (verbose) {
        console.log(`\n🔍 Query Parameters:`);
        console.log(`   Customer ID: ALL`);
        console.log(`   Time Window: ${timeWindowMinutes} minutes (${timeWindowInSeconds} seconds)`);
        console.log(`   Filter Time: ${new Date(filterTimeInMilliseconds).toISOString()}`);
        console.log(`   Current Time: ${new Date(currentTime).toISOString()}`);
        console.log(`   Table: ${ROSETTA_ALERTS_TABLE}`);
        console.log(`   Mode: Scan (no customer filter)\n`);
    }

    try {
        console.log(`⏳ Scanning ${ROSETTA_ALERTS_TABLE} for incidents (all customers)...`);

        let items = [];
        let lastEvaluatedKey = undefined;

        do {
            const scanParams = {
                TableName: ROSETTA_ALERTS_TABLE,
                FilterExpression: 'ExpiryTime > :filterTimeInMilliseconds',
                ExpressionAttributeValues: {
                    ':filterTimeInMilliseconds': filterTimeInMilliseconds,
                },
                ExclusiveStartKey: lastEvaluatedKey
            };

            const command = new ScanCommand(scanParams);
            const response = await docClient.send(command);
            items = items.concat(response.Items || []);
            lastEvaluatedKey = response.LastEvaluatedKey;

            if (verbose) {
                console.log(`   Retrieved ${items.length} items so far...`);
            }
        } while (lastEvaluatedKey);

        let alerts = items;

        if (verbose) {
            console.log(`✅ Retrieved ${alerts.length} alerts from DynamoDB\n`);
        }

        // Filter out excluded alert names if provided
        if (excludeAlertNames && excludeAlertNames.length > 0) {
            const beforeFilter = alerts.length;
            alerts = alerts.filter(alert => !excludeAlertNames.includes(alert.AlertName));

            if (verbose) {
                console.log(`🔧 Filtered out ${beforeFilter - alerts.length} alerts matching exclusion list`);
                console.log(`   Remaining: ${alerts.length}\n`);
            }
        }

        const incidentsList = alerts.map(alert => {
            let alertDetails = {};
            try {
                if (typeof alert.AlertDetails === 'string') {
                    alertDetails = JSON.parse(alert.AlertDetails);
                } else if (alert.AlertDetails) {
                    alertDetails = alert.AlertDetails;
                }
            } catch (e) {
                alertDetails = alert.AlertDetails || {};
            }

            return {
                incident_id: alert.Incident_Id || 'N/A',
                alert_name: alert.AlertName || 'N/A',
                parent_id: alert.Parent_Id || 'N/A',
                timestamp: alert.StartTime || 'N/A',
                timestamp_readable: alert.StartTime ? new Date(alert.StartTime).toISOString() : 'N/A',
                host_alert: alert.HostAlert || 'N/A',
                status: alert.STATUS || 'N/A',
                customer_id: alert.CustomerId || 'N/A',
                topology: alertDetails.topology || 'N/A',
                ip: alertDetails.ip || 'N/A',
                hostname: alertDetails.hostname || 'N/A',
                severity: alertDetails.severity || 'N/A',
                description: alertDetails.description || 'N/A'
            };
        });

        incidentsList.sort((a, b) => {
            const timeA = typeof a.timestamp === 'number' ? a.timestamp : 0;
            const timeB = typeof b.timestamp === 'number' ? b.timestamp : 0;
            return timeB - timeA;
        });

        return incidentsList;
    } catch (error) {
        console.error('❌ Error scanning DynamoDB:', error);
        throw error;
    }
}

