# CHAOS Extension - Quick Start Guide

⚡ Get up and running in 5 minutes!

## Step 1: Install Backend Dependencies (1 min)

```bash
cd /Users/eleopold/Downloads/msc-extension-chaos
npm install
```

## Step 2: Start Backend Service (1 min)

```bash
# Terminal #1 - Keep this running
node chaos-backend-service.js

# You should see:
# Server running on: http://localhost:3000
```

## Step 3: Load Extension in Chrome (2 min)

1. Open Chrome
2. Go to `chrome://extensions/`
3. Turn on "Developer mode" (top right)
4. Click "Load unpacked"
5. Select: `/Users/eleopold/Downloads/msc-extension-chaos`
6. ✅ Extension loaded!

## Step 4: Test It (1 min)

1. Go to MSC website: `https://mscentral.ams.adobe.net/`
2. Navigate to any cloud details page
3. Look for red **🔴 CHAOS (Incidents)** link
4. Click it and select your topology
5. Click "🔍 Search Incidents"

## That's it! 🎉

---

## Common Issues & Quick Fixes

### Backend won't start

```bash
# Port 3000 might be in use. Try a different port:
PORT=5000 node chaos-backend-service.js

# Update chaos.js to use the new port:
# Change: const apiUrl = 'http://localhost:3000/api/incidents';
# To:     const apiUrl = 'http://localhost:5000/api/incidents';
```

### Can't see CHAOS link on MSC pages

```bash
# 1. Refresh the Chrome extension
chrome://extensions/ → Find CHAOS → Click refresh icon

# 2. Clear Chrome cache
Ctrl+Shift+Delete → Clear browsing data

# 3. Reload the MSC page
```

### Getting "Unable to fetch incidents" error

```bash
# 1. Verify backend is running:
curl http://localhost:3000/api/health

# 2. Check AWS credentials:
aws sts get-caller-identity

# 3. Test incident extractor directly:
cd /Users/eleopold/Documents/_Rosetta/OneAdobe_Rosetta/CHAOS/incident-extractor
node extract-incidents.mjs --topology unilever-ufs-prod65-s3 --minutes 30
```

### Extension files not found

```bash
# Make sure you're in the right directory:
ls /Users/eleopold/Downloads/msc-extension-chaos/

# Should see:
# - manifest.json
# - chaos.html
# - chaos.js
# - background.js
# - chaos-backend-service.js
# - package.json
# - README.md
```

---

## Useful URLs

| Purpose              | URL                                |
| -------------------- | ---------------------------------- |
| Chrome Extensions    | `chrome://extensions/`             |
| Backend Health Check | `http://localhost:3000/api/health` |
| Backend Logs         | Check terminal where service runs  |
| MSC Portal           | `https://mscentral.ams.adobe.net/` |
| AWS Credentials      | `~/.aws/credentials`               |

---

## What's Next?

- Read the full [README.md](./README.md) for detailed documentation
- Explore the `/api/incidents` endpoint (see README.md for examples)
- Customize the UI by editing `chaos.html` and `chaos.js`
- Add more topologies to monitor

---

## Need Help?

Check these in order:

1. **Troubleshooting** section in README.md
2. Backend service logs (terminal output)
3. Chrome Extension errors (F12 → Console tab)
4. Extract incidents directly to verify the base tool works

---

**Made with ❤️ for CHAOS incident monitoring**
