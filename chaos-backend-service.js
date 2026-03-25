/**
 * CHAOS Backend Service
 * Express.js server that bridges the Chrome extension with the incident extractor
 * 
 * Install dependencies:
 *   npm install express cors
 * 
 * Run:
 *   node chaos-backend.js
 */

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readdir, readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const INCIDENT_EXTRACTOR_PATH = '/Users/eleopold/Documents/_Rosetta/OneAdobe_Rosetta/CHAOS/incident-extractor';
const CHECK_UPDATES_PATH = path.join(__dirname, 'check_updates');

/**
 * GET /api/incidents
 * Query parameters:
 *   - topology: required, topology name to query
 *   - minutes: optional, time window in minutes (default: 1440 = 24h)
 *   - output: optional, output format - json|csv|table (default: json)
 * Headers:
 *   - X-AWS-Access-Key-Id: AWS access key (required if not in .env)
 *   - X-AWS-Secret-Access-Key: AWS secret key (required if not in .env)
 *   - X-AWS-Region: AWS region (optional, defaults to us-east-1)
 */
app.get('/api/incidents', async (req, res) => {
    try {
        const topology = req.query.topology;
        const minutes = req.query.minutes || 1440;
        const output = req.query.output || 'json';

        // Validate topology parameter
        if (!topology || typeof topology !== 'string') {
            return res.status(400).json({
                error: 'topology parameter is required',
                example: '/api/incidents?topology=unilever-ufs-prod65-s3&minutes=30'
            });
        }

        console.log(`[${new Date().toISOString()}] Fetching incidents for topology: ${topology}, minutes: ${minutes}`);

        // Extract AWS credentials from headers or environment
        const awsAccessKeyId = req.headers['x-aws-access-key-id'] || process.env.AWS_ACCESS_KEY_ID;
        const awsSecretAccessKey = req.headers['x-aws-secret-access-key'] || process.env.AWS_SECRET_ACCESS_KEY;
        const awsRegion = req.headers['x-aws-region'] || process.env.AWS_REGION || 'us-east-1';

        if (!awsAccessKeyId || !awsSecretAccessKey) {
            return res.status(401).json({
                error: 'AWS credentials are required',
                message: 'Provide AWS credentials via headers (X-AWS-Access-Key-Id, X-AWS-Secret-Access-Key) or .env file'
            });
        }

        // Call the incident extractor with credentials
        const incidents = await callIncidentExtractor(topology, minutes, awsAccessKeyId, awsSecretAccessKey, awsRegion);

        res.json({
            success: true,
            topology,
            minutes,
            count: incidents.length,
            data: incidents,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error:', error);
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
        service: 'CHAOS Backend Service',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/incidents-csv
 * Get incidents in CSV format
 */
app.post('/api/incidents-csv', async (req, res) => {
    try {
        const { topology, minutes } = req.body;

        if (!topology) {
            return res.status(400).json({ error: 'topology is required' });
        }

        const incidents = await callIncidentExtractor(topology, minutes || 1440, 'csv');

        res.type('text/csv');
        res.attachment(`incidents_${topology}_${Date.now()}.csv`);
        res.send(incidents);

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/topology-updates
 * Triggers check_updates/get_prod_packages_ams.sh for a topology and time window.
 * Query parameters:
 *   - topology: required
 *   - unit: optional, minutes|hour|hours|days (default: hour)
 *   - value: optional, positive integer (default: 1)
 */
app.get('/api/topology-updates', async (req, res) => {
    try {
        const topology = req.query.topology;
        const unit = String(req.query.unit || 'hour').toLowerCase();
        const value = parseInt(String(req.query.value || '1'), 10);

        if (!topology || typeof topology !== 'string') {
            return res.status(400).json({
                error: 'topology parameter is required',
                example: '/api/topology-updates?topology=barcelo-stage-65&unit=hour&value=1'
            });
        }

        if (!Number.isInteger(value) || value <= 0) {
            return res.status(400).json({
                error: 'value must be a positive integer'
            });
        }

        const normalizedUnit = unit === 'hours' ? 'hour' : unit;
        const allowedUnits = new Set(['minutes', 'hour', 'days']);
        if (!allowedUnits.has(normalizedUnit)) {
            return res.status(400).json({
                error: 'unit must be one of: minutes, hour, hours, days'
            });
        }

        const result = await runTopologyUpdatesScript(topology, normalizedUnit, value);

        res.json({
            success: true,
            topology,
            window: {
                unit: normalizedUnit,
                value
            },
            outputDir: result.outputDir,
            packagesSummary: result.packagesSummary,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error running topology updates script:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * Call the incident extractor script
 */
async function callIncidentExtractor(topology, minutes, awsAccessKeyId, awsSecretAccessKey, awsRegion = 'us-east-1') {
    return new Promise((resolve, reject) => {
        try {
            // Build command arguments
            const args = [
                'extract-incidents.mjs',
                '--topology', topology,
                '--minutes', String(minutes),
                '--output', 'json'
            ];

            console.log('Executing:', `node ${args.join(' ')}`);

            // Build environment with AWS credentials
            const env = {
                ...process.env,
                AWS_ACCESS_KEY_ID: awsAccessKeyId,
                AWS_SECRET_ACCESS_KEY: awsSecretAccessKey,
                AWS_REGION: awsRegion,
                AWS_DEFAULT_REGION: awsRegion
            };

            // Spawn the Node process
            const proc = spawn('node', args, {
                cwd: INCIDENT_EXTRACTOR_PATH,
                env: env
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
                console.error('stderr:', data.toString());
            });

            proc.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Process exited with code ${code}`);
                    console.error('stderr:', stderr);
                    reject(new Error(`Incident extractor failed: ${stderr || 'Unknown error'}`));
                    return;
                }

                try {
                    // Parse the JSON output
                    // The script outputs the results with some logging, so we need to extract the JSON
                    const lines = stdout.split('\n');
                    let jsonStr = '';
                    let inJson = false;

                    for (const line of lines) {
                        if (line.trim().startsWith('[') || inJson) {
                            inJson = true;
                            jsonStr += line + '\n';
                            if (line.trim().endsWith(']')) {
                                break;
                            }
                        }
                    }

                    if (!jsonStr.trim()) {
                        // If no JSON found, return empty array
                        console.warn('No JSON output found from incident extractor');
                        resolve([]);
                        return;
                    }

                    const incidents = JSON.parse(jsonStr);
                    resolve(incidents);

                } catch (parseError) {
                    console.error('Parse error:', parseError);
                    console.error('stdout was:', stdout);
                    reject(new Error(`Failed to parse incident extractor output: ${parseError.message}`));
                }
            });

        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Run get_prod_packages_ams.sh with topology and selected time window.
 */
async function runTopologyUpdatesScript(topology, unit, value) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(CHECK_UPDATES_PATH, 'get_prod_packages_ams.sh');
        const args = [scriptPath, topology, `--${unit}`, String(value)];

        console.log('Executing updates script:', `bash ${args.join(' ')}`);

        const proc = spawn('bash', args, {
            cwd: CHECK_UPDATES_PATH,
            env: process.env
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', async (code) => {
            if (code !== 0) {
                reject(new Error(`Updates script failed with code ${code}: ${stderr || stdout || 'Unknown error'}`));
                return;
            }

            const outputDirMatch = stdout.match(/Output file:\s*(.+-prod-packages-[^\n]+)/);
            const outputDir = outputDirMatch ? path.dirname(outputDirMatch[1].trim()) : null;
            let packagesSummary = {
                hostsWithPackages: [],
                hostsWithoutPackages: [],
                totalPackages: 0
            };

            try {
                if (outputDir) {
                    packagesSummary = await collectPackagesSummary(topology, outputDir);
                }
            } catch (error) {
                console.warn('⚠️ Failed to collect packages summary:', error.message);
            }

            resolve({
                outputDir,
                packagesSummary
            });
        });

        proc.on('error', (error) => {
            reject(new Error(`Failed to start updates script: ${error.message}`));
        });
    });
}

async function collectPackagesSummary(topology, outputDir) {
    const files = await readdir(outputDir);
    const prodPackageFiles = files
        .filter((name) => name.startsWith(`${topology}-prod-packages-`) && name.endsWith('.json'))
        .sort();

    const latestProdPackagesFile = prodPackageFiles[prodPackageFiles.length - 1];
    if (!latestProdPackagesFile) {
        return {
            hostsWithPackages: [],
            hostsWithoutPackages: [],
            totalPackages: 0
        };
    }

    const prodPackagesPath = path.join(outputDir, latestProdPackagesFile);
    const prodPackagesRaw = await readFile(prodPackagesPath, 'utf8');
    const prodPackagesJson = JSON.parse(prodPackagesRaw);
    return buildPackagesSummary(prodPackagesJson);
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
            'POST /api/incidents-csv',
            'GET /api/health'
        ]
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║     CHAOS Backend Service - Incident Extractor Bridge     ║
╚════════════════════════════════════════════════════════════╝

Server running on: http://localhost:${PORT}

Available endpoints:
  • GET  /api/health                                     (Health check)
  • GET  /api/incidents?topology=<name>&minutes=<num>   (Get incidents)
    • GET  /api/topology-updates?topology=<name>&unit=<minutes|hour|days>&value=<num> (Run updates)
  • POST /api/incidents-csv                              (Download CSV)

Example:
  curl "http://localhost:${PORT}/api/incidents?topology=unilever-ufs-prod65-s3&minutes=30"

Configuration:
  - Incident Extractor Path: ${INCIDENT_EXTRACTOR_PATH}
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
