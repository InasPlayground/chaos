# Deploy CHAOS Backend Service to AWS EC2

This guide shows how to deploy your Node.js backend service to an AWS EC2 instance so you don't need to run it locally.

---

## **Step 1: Create & Configure EC2 Instance**

### 1.1 Launch a new EC2 instance

1. Go to [AWS EC2 Console](https://console.aws.amazon.com/ec2/)
2. Click **Launch instances**
3. Choose **Ubuntu 22.04 LTS** (free tier eligible)
4. Instance type: **t2.micro** (free tier)
5. VPC: Use your default VPC
6. **Configure Security Group:**
   - Allow SSH (port 22) from your IP
   - Allow HTTP (port 80) from anywhere OR your IP
   - Allow HTTPS (port 443) from anywhere (optional)
   - **Important**: Allow port 3001 (your backend port) from your IP

   | Type       | Protocol | Port Range | Source                 |
   | ---------- | -------- | ---------- | ---------------------- |
   | SSH        | TCP      | 22         | Your IP (or 0.0.0.0/0) |
   | HTTP       | TCP      | 80         | 0.0.0.0/0              |
   | Custom TCP | TCP      | 3001       | Your IP (or 0.0.0.0/0) |

7. Key pair: **Create new key pair** (save as `chaos-key.pem`) and download it
8. Storage: 20GB (default) is fine
9. Click **Launch instance**

Wait for the instance to reach "running" state.

---

## **Step 2: Connect to Your EC2 Instance**

### 2.1 Set permissions on your key file

```bash
chmod 400 ~/Downloads/chaos-key.pem
```

### 2.2 Get your instance's public IP

1. Go to EC2 Dashboard → Instances
2. Click your instance and note the **Public IPv4 address** (e.g., `54.123.45.67`)

### 2.3 SSH into the instance

```bash
ssh -i ~/Downloads/chaos-key.pem ubuntu@<YOUR_INSTANCE_IP>
```

Example:

```bash
ssh -i ~/Downloads/chaos-key.pem ubuntu@54.123.45.67
```

---

## **Step 3: Install Node.js on EC2**

Once connected via SSH, run:

```bash
# Update system packages
sudo apt update
sudo apt upgrade -y

# Install Node.js (v18+)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version
npm --version
```

---

## **Step 4: Upload Your Code to EC2**

### Option A: Upload via SCP (Recommended for initial setup)

From your local machine:

```bash
scp -i ~/Downloads/chaos-key.pem \
  -r /Users/eleopold/Documents/_Rosetta/OneAdobe_Rosetta/CHAOS/msc-extension-chaos \
  ubuntu@<YOUR_INSTANCE_IP>:~/chaos-extension
```

### Option B: Clone from Git (if code is in a repository)

On the EC2 instance:

```bash
cd ~
git clone <your-repo-url> chaos-extension
cd chaos-extension
```

---

## **Step 5: Configure AWS Credentials on EC2**

Your backend needs AWS credentials to access DynamoDB. There are two approaches:

### Option A: Use IAM Role (Recommended - more secure)

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Create a new role:
   - Service: EC2
   - Permissions: `AmazonDynamoDBReadOnlyAccess` or `AmazonDynamoDBFullAccess`
3. Attach this role to your EC2 instance:
   - EC2 Dashboard → Select instance
   - Instance Details → IAM instance profile
   - Click edit, choose your new role

Then on EC2, the SDK will automatically pick up credentials.

### Option B: Set Environment Variables (Simpler)

On your EC2 instance, create `.env` file:

```bash
cd ~/chaos-extension
nano .env
```

Add your AWS credentials:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
ROSETTA_ALERTS_TABLE=RosettaAlerts
```

Press `Ctrl+X`, then `Y`, then `Enter` to save.

⚠️ **Security Note**: This method stores credentials in a file. Use Option A (IAM Role) for production.

---

## **Step 6: Install Dependencies & Start Service**

On your EC2 instance:

```bash
# Navigate to your project
cd ~/chaos-extension

# Install Node.js dependencies
npm install

# Test the backend service
node chaos-backend-service.js
```

You should see:

```
[INFO] CHAOS Backend Service listening on port 3001
```

Press `Ctrl+C` to stop it temporarily.

---

## **Step 7: Run Service Permanently (Using PM2)**

To keep your service running even after you disconnect from SSH, use **PM2**:

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start your service with PM2
pm2 start chaos-backend-service.js --name "chaos-backend"

# Save PM2 config to auto-restart on reboot
pm2 startup
pm2 save

# Verify it's running
pm2 logs chaos-backend
```

Check status:

```bash
pm2 status
```

---

## **Step 8: Update Your Chrome Extension**

Now you need to point your extension to the external EC2 URL instead of `localhost:3000`.

### 8.1 Find your EC2 public IP

```bash
# On your EC2 instance
curl http://169.254.169.254/latest/meta-data/public-ipv4
```

Or check AWS EC2 Dashboard.

### 8.2 Update the extension code

Edit [chaos.js](chaos.js) and find where it calls the backend:

**Before (localhost):**

```javascript
const API_URL = "http://localhost:3001/api/incidents";
```

**After (EC2 server):**

```javascript
const API_URL = "http://54.123.45.67:3001/api/incidents";
```

Or use a domain name if you have one:

```javascript
const API_URL = "http://chaos-backend.example.com:3001/api/incidents";
```

### 8.3 Reload the extension

- Go to `chrome://extensions/`
- Find your CHAOS extension
- Click the refresh icon
- Now your extension will use the remote backend

---

## **Step 9: Verify It Works**

Test the backend health check from your local machine:

```bash
curl http://54.123.45.67:3001/api/health
```

You should see:

```json
{
  "status": "ok",
  "service": "CHAOS Backend Service",
  "version": "1.0.0",
  "timestamp": "2025-03-09T..."
}
```

Test an actual incident query:

```bash
curl "http://54.123.45.67:3001/api/incidents?topology=your-topology&minutes=1440"
```

---

## **Step 10: Maintenance & Monitoring**

### Check if service is running

```bash
pm2 status
```

### View logs

```bash
pm2 logs chaos-backend
```

### Restart the service

```bash
pm2 restart chaos-backend
```

### Stop the service

```bash
pm2 stop chaos-backend
```

### Disconnect from EC2

```bash
exit
```

The service will keep running on EC2.

---

## **Optional: Use a Domain Name Instead of IP**

If you have a domain, you can:

1. Point DNS `A` record to your EC2 public IP
2. Update extension to use:
   ```javascript
   const API_URL = "http://chaos-backend.yourdomain.com:3001/api/incidents";
   ```

This makes it easier to remember and more professional.

---

## **Optional: Enable HTTPS (SSL/TLS)**

For production, use HTTPS. Install **Certbot**:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot certonly --standalone -d chaos-backend.yourdomain.com
```

Then modify `chaos-backend-service.js` to use SSL:

```javascript
import https from "https";
import { readFileSync } from "fs";

const options = {
  key: readFileSync(
    "/etc/letsencrypt/live/chaos-backend.yourdomain.com/privkey.pem",
  ),
  cert: readFileSync(
    "/etc/letsencrypt/live/chaos-backend.yourdomain.com/fullchain.pem",
  ),
};

https.createServer(options, app).listen(443, () => {
  console.log("HTTPS server on port 443");
});
```

---

## **Estimated Monthly Cost (AWS Free Tier)**

- **t2.micro instance**: FREE (first 12 months)
- **Data transfer**: FREE within AWS
- **After free tier**: ~$8/month for a t2.micro

---

## **Troubleshooting**

| Issue                  | Solution                                                         |
| ---------------------- | ---------------------------------------------------------------- |
| Can't connect via SSH  | Check security group allows port 22, verify key pair permissions |
| 403 Forbidden error    | Check security group allows port 3001 from your IP               |
| Service not starting   | Run `pm2 logs chaos-backend` to see error details                |
| DynamoDB access denied | Check IAM role has `AmazonDynamoDBReadOnlyAccess` permissions    |
| Backend slow           | Might need larger instance (t2.small) or check network issues    |

---

## **Quick Reference**

```bash
# SSH into instance
ssh -i ~/Downloads/chaos-key.pem ubuntu@<PUBLIC_IP>

# Check if service is running
pm2 status

# View recent logs
pm2 logs chaos-backend -n 50

# Restart service if needed
pm2 restart chaos-backend

# Test API
curl http://<PUBLIC_IP>:3001/api/health
```
