/**
 * CHAOS Incident Viewer - Chrome Extension
 * Fetches and displays incidents from the incident extractor service
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log('🔵 CHAOS: DOMContentLoaded - Page loaded');
    
    const topologyInput = document.getElementById('topology');
    const timeRangeSelect = document.getElementById('timeRange');
    const viewBtn = document.getElementById('viewBtn');
    const clearBtn = document.getElementById('clearBtn');
    const settingsBtn = document.getElementById('settingsBtn');
    const resultsContainer = document.getElementById('resultsContainer');
    const resultCount = document.getElementById('resultCount');

    console.log('🔵 CHAOS: Elements loaded', {
        topologyInput: !!topologyInput,
        timeRangeSelect: !!timeRangeSelect,
        viewBtn: !!viewBtn,
        settingsBtn: !!settingsBtn,
        timeRangeValue: timeRangeSelect?.value
    });

    // Extract topology from URL if available
    const searchParams = new URLSearchParams(window.location.search);
    const initialTopology = searchParams.get('topology');
    console.log('🔵 CHAOS: URL Parameters', {
        rawUrl: window.location.search,
        topology: initialTopology
    });
    
    if (initialTopology) {
        topologyInput.value = decodeURIComponent(initialTopology);
        console.log('🔵 CHAOS: Topology set from URL:', topologyInput.value);
    }

    // Settings button click handler
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function() {
            console.log('🔵 CHAOS: Settings button clicked');
            openSettings();
        });
    }

    // View button click handler
    viewBtn.addEventListener('click', function() {
        const topology = topologyInput.value.trim();
        const timeRange = timeRangeSelect.value;

        console.log('🔵 CHAOS: View button clicked', {
            topology: topology,
            timeRange: timeRange,
            timeRangeElement: timeRangeSelect.value,
            timeRangeType: typeof timeRangeSelect.value,
            timeRangeInt: parseInt(timeRange)
        });

        if (!topology) {
            console.warn('🔴 CHAOS: No topology entered');
            showError('Please enter a topology name');
            return;
        }

        searchIncidents(topology, timeRange);
    });

    // Clear button click handler
    clearBtn.addEventListener('click', function() {
        console.log('🔵 CHAOS: Clear button clicked');
        topologyInput.value = '';
        timeRangeSelect.value = '2880';
        resultsContainer.innerHTML = '<div class="no-data">👋 Enter topology and select time range, then click View</div>';
        resultCount.textContent = '0 incidents';
    });

    // Allow Enter key to search
    topologyInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            console.log('🔵 CHAOS: Enter key pressed in topology input');
            viewBtn.click();
        }
    });

    /**
     * Open settings panel
     */
    function openSettings() {
        chrome.storage.local.get(['backendUrl', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion'], (result) => {
            const backendUrl = result.backendUrl || 'http://52.31.108.16:3001';
            const awsAccessKeyId = result.awsAccessKeyId || '';
            const awsSecretAccessKey = result.awsSecretAccessKey || '';
            const awsRegion = result.awsRegion || 'us-east-1';

            const settingsHTML = `
                <div class="settings-panel">
                    <h2>⚙️ Settings</h2>
                    <form id="settingsForm">
                        <div class="form-group">
                            <label for="backendUrl">Backend URL:</label>
                            <input type="text" id="backendUrl" value="${escapeHtml(backendUrl)}" placeholder="http://localhost:3001">
                        </div>
                        
                        <div class="form-group">
                            <label for="awsAccessKeyId">AWS Access Key ID:</label>
                            <input type="password" id="awsAccessKeyId" value="${escapeHtml(awsAccessKeyId)}" placeholder="Your AWS access key">
                        </div>
                        
                        <div class="form-group">
                            <label for="awsSecretAccessKey">AWS Secret Access Key:</label>
                            <input type="password" id="awsSecretAccessKey" value="${escapeHtml(awsSecretAccessKey)}" placeholder="Your AWS secret key">
                        </div>
                        
                        <div class="form-group">
                            <label for="awsRegion">AWS Region:</label>
                            <select id="awsRegion">
                                <option value="us-east-1" ${awsRegion === 'us-east-1' ? 'selected' : ''}>us-east-1</option>
                                <option value="us-west-2" ${awsRegion === 'us-west-2' ? 'selected' : ''}>us-west-2</option>
                                <option value="eu-west-1" ${awsRegion === 'eu-west-1' ? 'selected' : ''}>eu-west-1</option>
                                <option value="ap-southeast-1" ${awsRegion === 'ap-southeast-1' ? 'selected' : ''}>ap-southeast-1</option>
                            </select>
                        </div>
                        
                        <div class="button-group">
                            <button type="submit" class="btn-save">💾 Save</button>
                            <button type="button" class="btn-cancel" id="cancelSettings">Cancel</button>
                        </div>
                        
                        <p class="settings-note">⚠️ Credentials are stored locally in your browser and sent securely to the backend service.</p>
                    </form>
                </div>
            `;

            // Show settings in modal/overlay
            const originalContent = resultsContainer.innerHTML;
            resultsContainer.innerHTML = settingsHTML;
            
            const form = document.getElementById('settingsForm');
            const cancelBtn = document.getElementById('cancelSettings');

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const newBackendUrl = document.getElementById('backendUrl').value.trim();
                const newAccessKey = document.getElementById('awsAccessKeyId').value.trim();
                const newSecretKey = document.getElementById('awsSecretAccessKey').value.trim();
                const newRegion = document.getElementById('awsRegion').value;

                if (!newAccessKey || !newSecretKey) {
                    showError('AWS credentials cannot be empty');
                    return;
                }

                chrome.storage.local.set({
                    backendUrl: newBackendUrl,
                    awsAccessKeyId: newAccessKey,
                    awsSecretAccessKey: newSecretKey,
                    awsRegion: newRegion
                }, () => {
                    console.log('🔵 CHAOS: Settings saved');
                    showSuccess('Settings saved successfully');
                    setTimeout(() => {
                        resultsContainer.innerHTML = originalContent;
                    }, 1500);
                });
            });

            cancelBtn.addEventListener('click', () => {
                resultsContainer.innerHTML = originalContent;
            });
        });
    }

    /**
     * Search incidents from the backend service
     */
    function searchIncidents(topology, timeRange) {
        showLoading();

        chrome.storage.local.get(['backendUrl', 'awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion'], (result) => {
            const backendUrl = result.backendUrl || 'http://52.31.108.16:3001';
            const awsAccessKeyId = result.awsAccessKeyId;
            const awsSecretAccessKey = result.awsSecretAccessKey;
            const awsRegion = result.awsRegion || 'us-east-1';

            if (!awsAccessKeyId || !awsSecretAccessKey) {
                showError('AWS credentials not configured. Click ⚙️ Settings to add them.');
                return;
            }

            // Prepare API request
            const apiUrl = `${backendUrl}/api/incidents`;
            const minutes = parseInt(timeRange);

            const params = {
                topology: topology,
                minutes: minutes
            };

            const headers = {
                'X-AWS-Access-Key-Id': awsAccessKeyId,
                'X-AWS-Secret-Access-Key': awsSecretAccessKey,
                'X-AWS-Region': awsRegion
            };

            console.log('🔵 CHAOS: Sending API request', {
                apiUrl: apiUrl,
                params: params,
                queryString: new URLSearchParams(params).toString(),
                fullUrl: `${apiUrl}?${new URLSearchParams(params).toString()}`,
                headers: { ...headers, 'X-AWS-Secret-Access-Key': '***' }
            });

            // Make API call
            fetch(`${apiUrl}?${new URLSearchParams(params)}`, {
                method: 'GET',
                headers: headers
            })
                .then(response => {
                    console.log('🔵 CHAOS: API Response received', {
                        status: response.status,
                        ok: response.ok,
                        statusText: response.statusText
                    });
                    
                    if (!response.ok) {
                        return response.json().then(data => {
                            throw new Error(data.error || `API error: ${response.statusText}`);
                        }).catch(e => {
                            throw new Error(`API error: ${response.statusText}`);
                        });
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('🔵 CHAOS: Data received from API', {
                        success: data.success,
                        count: data.count,
                        incidents: data.data?.length || 0
                    });
                    displayResults(data);
                })
                .catch(error => {
                    console.error('🔴 CHAOS: Error fetching incidents:', error);
                    console.error('🔴 CHAOS: Error details:', {
                        message: error.message,
                        stack: error.stack
                    });
                    showError(`Unable to fetch incidents: ${error.message}`);
                });
        });
    }
    /**
     * Display search results
     */
    function displayResults(response) {
        console.log('🔵 CHAOS: displayResults called', {
            hasResponse: !!response,
            responseType: typeof response,
            isArray: Array.isArray(response),
            hasDataProperty: response?.data !== undefined,
            dataLength: response?.data?.length || 0,
            count: response?.count || 0,
            fullResponse: response
        });

        // Defensive: handle both direct array and object with data property
        let incidents = [];
        if (Array.isArray(response)) {
            console.warn('🟡 CHAOS: Response is a direct array, not an object');
            incidents = response;
        } else if (response && response.data && Array.isArray(response.data)) {
            incidents = response.data;
        } else if (response && response.data) {
            console.warn('🟡 CHAOS: response.data is not an array:', typeof response.data);
            incidents = [];
        } else {
            console.log('🔵 CHAOS: No incidents to display (empty response)');
            incidents = [];
        }

        // Handle no incidents case
        if (!incidents || incidents.length === 0) {
            console.log('🔵 CHAOS: No incidents to display');
            resultsContainer.innerHTML = '<div class="no-data">Zero incidents found! Either things are stable or the universe is plotting something.</div>';
            resultCount.textContent = '0 incidents';
            return;
        }

        try {
            const tableHTML = `
                <table>
                    <thead>
                        <tr>
                        <th>Incident ID</th>
                        <th>Alert Name</th>
                        <th>Timestamp</th>
                        <th>Status</th>
                        <th>Severity</th>
                        <th>Hostname</th>
                        <th>IP</th>
                    </tr>
                </thead>
                <tbody>
                    ${incidents.map(incident => `
                        <tr>
                            <td class="incident-id">${incident.incident_id || 'N/A'}</td>
                            <td>${incident.alert_name || 'N/A'}</td>
                            <td>
                                <span title="${incident.timestamp_readable || 'N/A'}">
                                    ${formatDate(incident.timestamp_readable)}
                                </span>
                            </td>
                            <td>
                                <span class="status-${incident.status ? incident.status.toLowerCase() : 'unknown'}">
                                    ${incident.status || 'Unknown'}
                                </span>
                            </td>
                            <td class="severity-${getSeverityClass(incident.severity)}">
                                ${incident.severity || 'Unknown'}
                            </td>
                            <td>${incident.hostname || 'N/A'}</td>
                            <td><code>${incident.ip || 'N/A'}</code></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

            resultsContainer.innerHTML = tableHTML;
            resultCount.textContent = `${incidents.length} ${incidents.length === 1 ? 'incident' : 'incidents'}`;
            console.log('🔵 CHAOS: Table displayed with', incidents.length, 'incidents');
        } catch (error) {
            console.error('🔴 CHAOS: Error rendering table:', error);
            showError('Failed to render incidents table: ' + error.message);
        }
    }

    /**
     * Format date for display
     */
    function formatDate(dateString) {
        if (!dateString) return 'N/A';

        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now - date;
            const diffMinutes = Math.floor(diffMs / (1000 * 60));

            if (diffMinutes < 1) return 'Just now';
            if (diffMinutes < 60) return `${diffMinutes}m ago`;
            if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;

            return date.toLocaleString();
        } catch (e) {
            return dateString;
        }
    }

    /**
     * Get severity CSS class
     */
    function getSeverityClass(severity) {
        if (!severity) return 'unknown';

        const sev = severity.toLowerCase();
        if (sev.includes('high') || sev.includes('critical')) return 'high';
        if (sev.includes('medium') || sev.includes('warn')) return 'medium';
        if (sev.includes('low')) return 'low';

        return 'unknown';
    }

    /**
     * Show loading state
     */
    function showLoading() {
        console.log('🔵 CHAOS: Showing loading state');
        resultsContainer.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>Fetching incidents!  Hang tight while we discover what decided to stop working</p>
            </div>
        `;
    }

    /**
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text ? String(text).replace(/[&<>"']/g, m => map[m]) : '';
    }

    /**
     * Show error message
     */
    function showError(message) {
        console.error('🔴 CHAOS: Showing error:', message);
        resultsContainer.innerHTML = `<div class="error">❌ ${message}</div>`;
    }

    /**
     * Show success message
     */
    function showSuccess(message) {
        console.log('🟢 CHAOS: Showing success:', message);
        resultsContainer.innerHTML = `<div class="success">✓ ${message}</div>`;
    }
});
