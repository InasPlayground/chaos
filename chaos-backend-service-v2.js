/**
 * CHaOS Backend Service v2
 * Express.js server that directly queries DynamoDB for incidents
 * 
 * Install dependencies:
 *   npm install express cors @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb dotenv
 * 
 * Run:
 *   node chaos-backend-service-v2.js
 */

import express from 'express';
import cors from 'cors';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawn } from 'child_process';
import { readdir, readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// AWS Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const ROSETTA_ALERTS_TABLE = process.env.ROSETTA_ALERTS_TABLE || 'RosettaAlerts';
const CHECK_UPDATES_PATH = join(__dirname, 'check_updates');

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
}

const dynamoDBClient = new DynamoDBClient(clientConfig);
const docClient = DynamoDBDocumentClient.from(dynamoDBClient);

// Middleware
app.use(cors());
app.use(express.json());

/**
 * GET /api/incidents
 * Query DynamoDB directly for incidents by topology
 * 
 * Query parameters:
 *   - topology: required, topology name to query
 *   - minutes: optional, time window in minutes (default: 1440 = 24h)
 */
app.get('/api/incidents', async (req, res) => {
    try {
        const topology = req.query.topology;
        const minutes = parseInt(req.query.minutes) || 1440;

        console.log(`\n🔵 [${new Date().toISOString()}] /api/incidents - Request received`);
        console.log('  Query Parameters:', { topology, minutes, minutesType: typeof minutes });

        // Validate topology parameter
        if (!topology || typeof topology !== 'string') {
            console.warn('🔴 CHaOS: Missing or invalid topology parameter');
            return res.status(400).json({
                error: 'topology parameter is required',
                example: '/api/incidents?topology=mmm-prod2&minutes=30'
            });
        }

        console.log(`🔵 Querying incidents for topology: ${topology}, minutes: ${minutes}`);

        // Query DynamoDB directly
        const incidents = await queryIncidents(topology, minutes);

        console.log(`🔵 Successfully retrieved ${incidents.length} incidents`);

        res.json({
            success: true,
            topology,
            minutes,
            count: incidents.length,
            data: incidents,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('🔴 Error in /api/incidents:', error);
        console.error('🔴 Error message:', error.message);
        console.error('🔴 Error stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'CHaOS Backend Service',
        version: '2.0.0',
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /api/topology-updates
 * Run topology updates script from check_updates folder.
 *
 * Query parameters:
 *   - topology: required, topology name
 *   - unit: required, one of minutes|hour|days
 *   - value: required, positive integer
 */
app.get('/api/topology-updates', async (req, res) => {
    try {
        const topology = req.query.topology;
        const unit = req.query.unit;
        const value = parseInt(req.query.value, 10);

        if (!topology || typeof topology !== 'string') {
            return res.status(400).json({
                error: 'topology parameter is required',
                example: '/api/topology-updates?topology=row-wargames-aws-lts&unit=days&value=2'
            });
        }

        if (!['minutes', 'hour', 'days'].includes(unit)) {
            return res.status(400).json({
                error: 'unit parameter must be one of: minutes, hour, days'
            });
        }

        if (!Number.isInteger(value) || value <= 0) {
            return res.status(400).json({
                error: 'value parameter must be a positive integer'
            });
        }

        const result = await runTopologyUpdatesScript(topology, unit, value);

        res.json({
            success: true,
            topology,
            unit,
            value,
            ...result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('🔴 Error in /api/topology-updates:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Query DynamoDB for incidents within the specified time window by topology
 */
async function queryIncidents(topology, timeWindowMinutes) {
    const currentTime = Date.now();
    const timeWindowInSeconds = timeWindowMinutes * 60; // Convert minutes to seconds
    const filterTimeInMilliseconds = currentTime - (timeWindowInSeconds * 1000);

    console.log('\n🔵 queryIncidents - DynamoDB Scan Details:');
    console.log(`  Table: ${ROSETTA_ALERTS_TABLE}`);
    console.log(`  Topology: "${topology}"`);
    console.log(`  Time Window: ${timeWindowMinutes} minutes`);
    console.log(`  Current Time: ${new Date(currentTime).toISOString()}`);
    console.log(`  AWS Region: ${AWS_REGION}`);
    console.log(`  Mode: Scan all incidents (active and expired) with topology filter in AlertDetails JSON\n`);

    const scanParams = {
        TableName: ROSETTA_ALERTS_TABLE,
    };

    console.log('🔵 Scan Parameters:', JSON.stringify(scanParams, null, 2));

    try {
        console.log(`🔵 Executing DynamoDB ScanCommand with pagination...`);
        
        let allItems = [];
        let lastEvaluatedKey = undefined;
        let pageCount = 0;

        // Scan with pagination
        do {
            pageCount++;
            const command = new ScanCommand({ ...scanParams, ExclusiveStartKey: lastEvaluatedKey });
            const scanResult = await docClient.send(command);
            allItems = allItems.concat(scanResult.Items || []);
            lastEvaluatedKey = scanResult.LastEvaluatedKey;

            console.log(`🔵 Scan page ${pageCount}: ${allItems.length} total items retrieved so far...`);
        } while (lastEvaluatedKey);

        console.log(`🔵 Total items scanned: ${allItems.length}`);

        // Filter by topology (topology is stored in AlertDetails JSON)
        let alerts = allItems.filter(alert => {
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

        console.log(`🔵 After topology filter: ${alerts.length} alerts match topology "${topology}"`);

        if (alerts.length > 0) {
            console.log(`🔵 Sample alert structure:`, JSON.stringify(alerts[0], null, 2));
            console.log(`🟢 Successfully found ${alerts.length} incidents`);
        } else {
            console.log(`⚠️  No incidents found matching topology "${topology}"`);
        }

        if (alerts.length === 0) {
            return [];
        }

        console.log(`🔵 Processing ${alerts.length} alerts...`);

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

        // Sort by timestamp (most recent first)
        incidentsList.sort((a, b) => {
            const timeA = typeof a.timestamp === 'number' ? a.timestamp : 0;
            const timeB = typeof b.timestamp === 'number' ? b.timestamp : 0;
            return timeB - timeA;
        });

        console.log(`🟢 Successfully processed ${incidentsList.length} incidents`);
        return incidentsList;

    } catch (error) {
        console.error('🔴 Error querying DynamoDB:', error);
        console.error('🔴 Error Name:', error.name);
        console.error('🔴 Error Message:', error.message);
        console.error('🔴 Error Code:', error.__type);
        throw new Error(`DynamoDB query failed: ${error.message}`);
    }
}

/**
 * Execute get_prod_packages_ams.sh with topology and relative time args.
 */
function runTopologyUpdatesScript(topology, unit, value) {
    return new Promise((resolve, reject) => {
        const scriptPath = join(CHECK_UPDATES_PATH, 'get_prod_packages_ams.sh');
        const unitFlag = `--${unit}`;
        const args = [scriptPath, topology, unitFlag, String(value)];

        const child = spawn('bash', args, {
            cwd: CHECK_UPDATES_PATH,
            env: { ...process.env }
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('error', (err) => {
            reject(new Error(`Failed to start script: ${err.message}`));
        });

        child.on('close', async (code) => {
            if (code !== 0) {
                const details = stderr || stdout || 'No output from script';
                return reject(new Error(`Script exited with code ${code}: ${details}`));
            }

            const outputDirMatch = stdout.match(/(?:Created output directory|Using existing output directory):\s*([^\n]+)/i)
                || stderr.match(/(?:Created output directory|Using existing output directory):\s*([^\n]+)/i);
            const outputDir = outputDirMatch ? outputDirMatch[1].trim() : '';

            const updatesSummary = await collectTopologyUpdateSummary(topology, outputDir);

            resolve({
                outputDir,
                updatesSummary
            });
        });
    });
}

/**
 * Read generated update files and build a structured summary for UI rendering.
 */
async function collectTopologyUpdateSummary(topology, outputDir) {
    if (!outputDir) {
        return {
            aemStatusMessage: '',
            cmDeployStatus: '',
            dispatcherModifications: '',
            dispatcherInfoFile: '',
            packagesSummary: {
                hostsWithPackages: [],
                hostsWithoutPackages: [],
                totalPackages: 0
            }
        };
    }

    const summary = {
        aemStatusMessage: '',
        cmDeployStatus: '',
        dispatcherModifications: '',
        dispatcherInfoFile: '',
        packagesSummary: {
            hostsWithPackages: [],
            hostsWithoutPackages: [],
            totalPackages: 0
        }
    };

    const outputDirPath = join(CHECK_UPDATES_PATH, outputDir);

    // AEM status from <topology>.json -> status_message
    try {
        const topologyJsonPath = join(outputDirPath, `${topology}.json`);
        const topologyJsonRaw = await readFile(topologyJsonPath, 'utf8');
        const topologyJson = JSON.parse(topologyJsonRaw);
        summary.aemStatusMessage = topologyJson.status_message || '';
    } catch (error) {
        console.warn('⚠️ Could not read AEM status message from topology JSON:', error.message);
    }

    // Dispatcher and CM details from latest dispatcher-info text file
    try {
        const files = await readdir(outputDirPath);
        const dispatcherFiles = files
            .filter((name) => name.startsWith(`${topology}-dispatcher-info-`) && name.endsWith('.txt'))
            .sort();

        const latestDispatcherFile = dispatcherFiles[dispatcherFiles.length - 1];
        if (latestDispatcherFile) {
            summary.dispatcherInfoFile = latestDispatcherFile;
            const dispatcherPath = join(outputDirPath, latestDispatcherFile);
            const dispatcherText = await readFile(dispatcherPath, 'utf8');

            const cmMatch = dispatcherText.match(/Build Status:\s*\n([^\n]+)/i);
            summary.cmDeployStatus = cmMatch ? cmMatch[1].trim() : '';

            const modsMatch = dispatcherText.match(/Modified Files in Last 24 Hours:\s*\n=+\s*\n([\s\S]*)$/i);
            summary.dispatcherModifications = modsMatch ? modsMatch[1].trim() : '';
        }
    } catch (error) {
        console.warn('⚠️ Could not read dispatcher info summary:', error.message);
    }

    // Package details from latest <topology>-prod-packages-*.json
    try {
        const files = await readdir(outputDirPath);
        const prodPackageFiles = files
            .filter((name) => name.startsWith(`${topology}-prod-packages-`) && name.endsWith('.json'))
            .sort();

        const latestProdPackagesFile = prodPackageFiles[prodPackageFiles.length - 1];
        if (latestProdPackagesFile) {
            const prodPackagesPath = join(outputDirPath, latestProdPackagesFile);
            const prodPackagesRaw = await readFile(prodPackagesPath, 'utf8');
            const prodPackagesJson = JSON.parse(prodPackagesRaw);
            summary.packagesSummary = buildPackagesSummary(prodPackagesJson);
        }
    } catch (error) {
        console.warn('⚠️ Could not read package summary:', error.message);
    }

    return summary;
}

function buildPackagesSummary(prodPackagesJson) {
    const hosts = Array.isArray(prodPackagesJson?.hosts) ? prodPackagesJson.hosts : [];
    const hostsWithPackages = [];
    const hostsWithoutPackages = [];

    for (const host of hosts) {
        const hostname = host?.hostname || 'unknown-host';
        const rawPackages = Array.isArray(host?.packages) ? host.packages : [];
        const parsedPackages = rawPackages
            .map((entry) => parsePackageInfo(entry?.package_info))
            .filter((entry) => entry !== null);

        if (parsedPackages.length > 0) {
            hostsWithPackages.push({ hostname, packages: parsedPackages });
        } else {
            hostsWithoutPackages.push(hostname);
        }
    }

    const totalPackages = hostsWithPackages.reduce((sum, host) => sum + host.packages.length, 0);
    return { hostsWithPackages, hostsWithoutPackages, totalPackages };
}

function parsePackageInfo(packageInfo) {
    if (!packageInfo || typeof packageInfo !== 'string') {
        return null;
    }

    const timestampMatch = packageInfo.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (!timestampMatch) {
        return null;
    }

    const installedAt = timestampMatch[1];
    const packagePrefix = packageInfo.slice(0, timestampMatch.index).trim();
    const columns = packagePrefix.split(/\s{2,}/).filter(Boolean);
    const fileName = columns.length >= 2 ? columns[1] : columns[columns.length - 1] || '';
    const packageName = fileName.replace(/\.zip$/i, '');

    return {
        name: packageName || fileName || 'unknown-package',
        installedAt
    };
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        path: req.path,
        availableEndpoints: [
            'GET /api/incidents?topology=<name>&minutes=<number>',
            'GET /api/topology-updates?topology=<name>&unit=<minutes|hour|days>&value=<number>',
            'GET /api/health'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║         CHaOS Backend Service v2 - DynamoDB Direct        ║
╚════════════════════════════════════════════════════════════╝

Server running on: http://localhost:${PORT}

Available endpoints:
  • GET  /api/health                                       (Health check)
  • GET  /api/incidents?topology=<name>&minutes=<num>     (Get incidents)
    • GET  /api/topology-updates?topology=<name>&unit=<minutes|hour|days>&value=<num> (Run updates)

Example:
  curl "http://localhost:${PORT}/api/incidents?topology=mmm-prod2&minutes=30"

Configuration:
  - DynamoDB Table: ${ROSETTA_ALERTS_TABLE}
  - AWS Region: ${AWS_REGION}
  - Port: ${PORT}

Press Ctrl+C to stop the server
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    process.exit(0);
});
