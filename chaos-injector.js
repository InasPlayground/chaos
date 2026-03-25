/**
 * CHAOS Extension - Adds CHAOS link to MSC pages
 * Injects a new link for CHAOS incident viewer next to CM History
 */

// Wait for page to load and inject CHAOS link
document.addEventListener('DOMContentLoaded', function() {
    // Give the page more time to load and render the menu
    setTimeout(function() {
        addChaosLink();
    }, 2000);
});

// Also try to inject on script load  
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addChaosLink);
} else {
    setTimeout(addChaosLink, 2000);
}

/**
 * Add CHAOS link to the page
 */
function addChaosLink() {
    try {
        // Check if CHAOS link already exists to prevent duplicates
        const existingChaosLink = document.querySelector('a[href*="chaos.html"]');
        if (existingChaosLink) {
            return;
        }

        // Find the topology name from the page
        const topologyName = getTopologyName();

        if (!topologyName) {
            console.warn('CHAOS: Could not extract topology name from page');
            return;
        }

        // Look for CM History link on any MSC page
        const allLinks = Array.from(document.querySelectorAll('a'));
        
        // Find CM History - try multiple variations
        let cmHistoryElement = allLinks.find(a => {
            const href = a.href.toLowerCase();
            const text = a.textContent.trim();
            // Look for exact "CM History" match first
            if (text === 'CM History') {
                return true;
            }
            // Fallback: cmhistory in href
            return href.includes('cmhistory');
        });
        
        if (!cmHistoryElement) {
            cmHistoryElement = allLinks.find(a => {
                const text = a.textContent.toLowerCase();
                return text.includes('cm') && text.includes('history');
            });
        }

        if (!cmHistoryElement) {
            // Try just "History" in left menu
            cmHistoryElement = allLinks.find(a => {
                const text = a.textContent.trim();
                return text === 'History';
            });
        }

        if (cmHistoryElement) {
            // Create the CHAOS link that opens the extension page properly
            const chaosLink = document.createElement('a');
            chaosLink.href = '#';
            chaosLink.style.color = '#ff6b6b';
            chaosLink.style.padding = '0px 0px 0px 15px';
            chaosLink.style.textDecoration = 'none';
            chaosLink.style.display = 'block';
            chaosLink.style.marginTop = '5px';
            chaosLink.title = `View CHAOS incidents for ${topologyName}`;
            chaosLink.setAttribute('data-chaos-link', 'true');
            chaosLink.textContent = 'CHAOS Viewer';
            
            // Add click handler to open extension page
            chaosLink.addEventListener('click', function(e) {
                e.preventDefault();
                console.log('CHAOS: Opening CHAOS Viewer for topology:', topologyName);
                const extensionUrl = chrome.runtime.getURL(`chaos.html?topology=${encodeURIComponent(topologyName)}`);
                console.log('CHAOS: Extension URL:', extensionUrl);
                window.open(extensionUrl, '_blank');
            });
            
            cmHistoryElement.insertAdjacentElement('afterend', chaosLink);
        } else {
            console.warn('CHAOS: Could not find CM History link on this page');
        }

    } catch (error) {
        console.error('CHAOS: Error adding link:', error);
    }
}

/**
 * Extract topology name from the page
 */
function getTopologyName() {
    try {
        // Try to get from URL cmhistory parameter (BigBear pages)
        const urlParams = new URLSearchParams(window.location.search);
        const cmHistoryUrl = urlParams.get('cmhistory');
        if (cmHistoryUrl) {
            const topologyMatch = cmHistoryUrl.match(/topologies\/([a-z0-9]+)/);
            if (topologyMatch && topologyMatch[1]) {
                return topologyMatch[1];
            }
        }
        
        // Try to get from URL path (new method)
        const systemMatch = window.location.pathname.match(/\/systems\/([^/?]+)/);
        if (systemMatch && systemMatch[1]) {
            let systemName = systemMatch[1];
            // Remove timestamp suffix (e.g., -20260120-081025 or -20230724-115458)
            const topologyName = systemName.replace(/-\d{8}-\d{6}$/, '');
            return topologyName;
        }
        
        // Try to get from account in URL
        const accountMatch = window.location.pathname.match(/\/accounts\/([^/?]+)\//);
        if (accountMatch && accountMatch[1]) {
            return accountMatch[1];
        }
        
        // Try to get from MSC script variable
        const scripts = document.querySelectorAll('script');
        for (let script of scripts) {
            if (script.textContent.includes('MSCentral.topologyName')) {
                // Parse the topology name from the script
                const match = script.textContent.match(/MSCentral\.topologyName\s*=\s*"([^"]+)"/);
                if (match && match[1]) {
                    return match[1];
                }
            }
        }

        // Try to get from page title or heading
        const h1 = document.querySelector('h1');
        if (h1 && h1.textContent) {
            const titleMatch = h1.textContent.match(/([a-z0-9\-_]+)/i);
            if (titleMatch && titleMatch[1]) {
                return titleMatch[1];
            }
        }

        // Try to get from instance panel headings
        const instanceHeadings = document.querySelectorAll('.topology-details-instance-name');
        if (instanceHeadings.length > 0) {
            const firstHeading = instanceHeadings[0].textContent;
            // Extract topology from instance name (usually format: topology-instance)
            const parts = firstHeading.split('-');
            if (parts.length > 1) {
                const topologyName = parts.slice(0, -1).join('-').trim();
                return topologyName;
            }
        }

        return null;
    } catch (error) {
        console.error('CHAOS: Error extracting topology name:', error);
        return null;
    }
}

// Export functions for testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { addChaosLink, getTopologyName };
}

