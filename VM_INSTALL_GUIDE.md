# VM Installation & Configuration for CHAOS Backend Service

Quick setup guide to deploy your backend service on an existing VM.

---

## **Prerequisites**

- SSH access to your VM
- Your VM's public IP address
- Your AWS credentials (Access Key ID & Secret Access Key)
- Port 3001 open in your VM's firewall

---

## **1. Install Node.js (Ubuntu/Debian)**

SSH into your VM:

```bash
ssh -i your-key.pem ubuntu@YOUR_VM_IP
```

Update system and install Node.js:

```bash
sudo apt update
sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node --version
npm --version
```

---

## **2. Upload Your Code**

From your **local machine**, copy the project to your VM:

```bash
scp -i your-key.pem -r /Users/eleopold/Documents/_Rosetta/OneAdobe_Rosetta/CHAOS/msc-extension-chaos \
  ubuntu@YOUR_VM_IP:~/chaos-backend
```

Verify on VM:

```bash
ls -la ~/chaos-backend
```

---

## **3. Create & Configure `.env` File**

SSH into your VM and create the environment file:

```bash
cd ~/chaos-backend
nano .env
```

Add your AWS credentials:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=YOUR_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
ROSETTA_ALERTS_TABLE=RosettaAlerts
```

Save: `Ctrl+X` → `Y` → `Enter`

---

## **4. Install Node Dependencies**

```bash
cd ~/chaos-backend
npm install
```

Expected packages: `express`, `cors`

---

## **5. Test the Service**

Start the backend manually to verify it works:

```bash
node chaos-backend-service.js
```

You should see:

```
[INFO] Server listening on port 3001
```

Test in another terminal (from your local machine):

```bash
curl http://YOUR_VM_IP:3001/api/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "CHAOS Backend Service",
  "version": "1.0.0",
  "timestamp": "2025-03-09T..."
}
```

Stop the service: `Ctrl+C`

---

## **6. Run Permanently with PM2**

Install PM2 globally:

```bash
sudo npm install -g pm2
```

Start your backend service:

```bash
pm2 start chaos-backend-service.js --name "chaos-backend"
```

Enable auto-restart on VM reboot:

```bash
pm2 startup
pm2 save
```

Verify it's running:

```bash
pm2 status
```

You should see:

```
┌──────────────┬────┬─────────┬──────┬──────┬────────┐
│ App name     │ id │ version │ mode │ pid  │ status │
├──────────────┼────┼─────────┼──────┼──────┼────────┤
│ chaos-backend│ 0  │ 0.1.0   │ fork │ 1234 │ online │
└──────────────┴────┴─────────┴──────┴──────┴────────┘
```

View logs:

```bash
pm2 logs chaos-backend
```

---

## **7. Update Your Extension**

Now update your Chrome extension to use the VM IP instead of `localhost`.

Edit [chaos.js](chaos.js) and find the API URL (should be around line 20-30):

**Before:**

```javascript
const API_URL = "http://localhost:3001/api/incidents";
```

**After:**

```javascript
const API_URL = "http://YOUR_VM_IP:3001/api/incidents";
```

Example:

```javascript
const API_URL = "http://54.123.45.67:3001/api/incidents";
```

**Optional:** If your VM has a domain name:

```javascript
const API_URL = "http://chaos-backend.yourdomain.com:3001/api/incidents";
```

---

## **8. Reload Extension**

- Open `chrome://extensions/`
- Find your CHAOS extension
- Click the **refresh** icon
- The extension now uses your remote VM

---

## **9. Test End-to-End**

From your Chrome extension:

1. Click the red **🔴 CHAOS** button
2. Select a topology
3. Choose time range
4. Click **Search Incidents**

Or test from terminal:

```bash
curl "http://YOUR_VM_IP:3001/api/incidents?topology=your-topology&minutes=1440"
```

---

## **Maintenance Commands**

```bash
# Check status
pm2 status

# View logs
pm2 logs chaos-backend

# Restart service
pm2 restart chaos-backend

# Stop service
pm2 stop chaos-backend

# Start service
pm2 start chaos-backend

# Remove from PM2
pm2 delete chaos-backend
```

---

## **Troubleshooting**

| Issue                          | Solution                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `Cannot find module 'express'` | Run `npm install` in ~/chaos-backend                                                          |
| `ECONNREFUSED 3001`            | Service not running. Check `pm2 status` and `pm2 logs`                                        |
| `503 DynamoDB Error`           | Check AWS credentials in `.env`. Verify AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY are correct |
| `Cannot connect to VM`         | Verify port 3001 is open in firewall. Check VM IP with `hostname -I` on VM                    |
| Service crashes after restart  | Check logs: `pm2 logs chaos-backend`                                                          |

---

## **Done! 🎉**

Your backend is now running on your VM. You can:

- ✅ Disconnect from SSH (`exit`)
- ✅ Service keeps running automatically
- ✅ Use extension without local Node process
- ✅ Access from anywhere (if firewall allows)

**Next time you SSH in:**

```bash
ssh -i your-key.pem ubuntu@YOUR_VM_IP
pm2 status
```
