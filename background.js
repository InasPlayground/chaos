/**
 * Background Service Worker for CHAOS Extension
 * Handles API requests and cross-origin communication
 */

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getIncidents') {
        fetchIncidentsFromService(request.topology, request.minutes)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
    }
});

/**
 * Fetch incidents from the backend service
 */
async function fetchIncidentsFromService(topology, minutes) {
    try {
        // Replace with your actual backend service URL
        const serviceUrl = 'http://localhost:3000/api/incidents';

        const response = await fetch(`${serviceUrl}?topology=${topology}&minutes=${minutes}`);

        if (!response.ok) {
            throw new Error(`API returned status ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching incidents:', error);
        throw error;
    }
}

// Handle service worker installation
chrome.runtime.onInstalled.addListener(() => {
    console.log('CHAOS Extension installed successfully');
});
