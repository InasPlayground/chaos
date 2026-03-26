# CHAOS - AWS Credentials Management (Local Storage)

## **Architecture Change**

Previously, AWS credentials were stored on the backend VM. Now, credentials stay on your local machine and are sent securely with each API request.

### **How It Works**

```
Local Browser                          Remote VM
┌─────────────────────┐               ┌──────────────────┐
│ Chaos Extension     │               │ Backend Service  │
│ - Store Creds      │───Request─────▶│ - Receive Creds  │
│  (Local Storage)    │  + Headers     │ - Use for Query  │
│ - Send with Request│               │ - Return Results │
└─────────────────────┘              └──────────────────┘
         ↓
   Chrome Storage API
   (Local Only)
```

### **Key Benefits**

✅ **Credentials never stored on remote VM**  
✅ **Encrypted in browser local storage**  
✅ **Credentials transmitted with each request in headers**  
✅ **No .env file needed on VM**  
✅ **More secure - VM doesn't hold credentials**

---

## **Setup Steps**

### **1. Update Backend VM**

The VM no longer needs `.env` credentials. You can now **delete or comment out** the `.env` file:

```bash
ssh your-vm
cd ~/chaos-backend

# Remove or rename the .env file (credentials no longer needed)
rm .env
# OR
# mv .env .env.backup
```

VM is ready - the service now accepts credentials from requests.

---

### **2. Configure Credentials in Chrome Extension**

When you use the extension for the first time:

1. Open the CHAOS extension popup
2. Click the **⚙️ Settings** button
3. Enter your AWS credentials:
   - **AWS Access Key ID**: Your AWS access key
   - **AWS Secret Access Key**: Your AWS secret key
   - **AWS Region**: Select your region (default: us-east-1)

- **Backend URL**: Your VM's URL (e.g., `http://54.123.45.67:8080`)

4. Click **💾 Save**

### **Credentials are stored in your browser's local storage** (not on server)

---

## **How Each Request Works**

1. User clicks "Search Incidents" in the extension
2. Extension reads stored AWS credentials from local storage
3. Extension sends API request with headers:
   ```
   X-AWS-Access-Key-Id: YOUR_KEY
   X-AWS-Secret-Access-Key: YOUR_SECRET
   X-AWS-Region: us-east-1
   ```
4. Backend receives request + credentials
5. Backend spawns incident extractor with those credentials
6. Incident extractor queries DynamoDB
7. Results returned to extension
8. User sees incidents in the popup

---

## **Security Notes**

✅ **What's Secure:**

- Credentials stored in Chrome's local storage (per-device)
- Only accessible by the extension
- Credentials not visible in browser history
- Network requests use HTTPS (if configured)

⚠️ **Limitations:**

- If someone gains access to your computer, they can access stored credentials
- Always logout when sharing your computer
- Consider using IAM role approach instead (see below)

---

## **More Secure Alternative: AWS IAM Role**

If you're concerned about storing credentials, use AWS IAM role on the backend VM:

1. Create an IAM role in AWS with DynamoDB access
2. Attach the role to your EC2 instance
3. The instance automatically has credentials - no need to store them
4. Backend queries DynamoDB without credentials

In this case, the extension would send **user identity only** (not credentials):

```
X-User-Id: eleopold
```

Contact your AWS administrator to set this up.

---

## **Troubleshooting**

| Issue                            | Solution                                                 |
| -------------------------------- | -------------------------------------------------------- |
| "AWS credentials not configured" | Open ⚙️ Settings and enter your AWS keys                 |
| "401 Unauthorized"               | Verify Access Key and Secret Key are correct in Settings |
| "DynamoDB access denied"         | Check your AWS credentials have DynamoDB permissions     |
| Settings not saving              | Clear browser cache and try again                        |
| CORS errors                      | Verify Backend URL in settings is correct                |

---

## **Updating Credentials**

To update your AWS credentials:

1. Click ⚙️ Settings
2. Edit the credentials
3. Click 💾 Save

Changes take effect immediately on next search.

---

## **Removing Credentials**

To remove stored credentials from your browser:

1. Click ⚙️ Settings
2. Clear the credential fields
3. Click 💾 Cancel (or delete them manually)

Or use Chrome's built-in settings:

- Settings → Privacy & Security → Delete browsing data → Cookies and site data
- Select your domain/extension

---

## **Environment Variables (Optional)**

If you want to keep the `.env` file on the VM as a fallback:

```env
AWS_REGION=us-east-1
# Leave these empty - will use credentials from request headers instead
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
ROSETTA_ALERTS_TABLE=RosettaAlerts
```

The backend will:

1. Try credentials from request headers first
2. Fall back to `.env` if headers are missing
3. If neither exists, return 401 error

---

## **API Reference**

### **Request Headers**

Your extension automatically sends:

```
GET /api/incidents?topology=<name>&minutes=<num>

Headers:
  X-AWS-Access-Key-Id: <your_access_key>
  X-AWS-Secret-Access-Key: <your_secret_key>
  X-AWS-Region: us-east-1
```

### **Response**

```json
{
  "success": true,
  "topology": "your-topology",
  "minutes": 1440,
  "count": 5,
  "data": [
    {
      "incident_id": "INC-12345",
      "alert_name": "High Memory Usage",
      "severity": "high",
      "status": "running",
      "timestamp_readable": "2025-03-09T10:30:00Z"
    }
  ]
}
```

---

## **Testing**

From your local machine, test the setup:

```bash
# Test health check (no credentials needed)
curl http://YOUR_VM_IP:8080/api/health

# Test with credentials
curl -H "X-AWS-Access-Key-Id: YOUR_KEY" \
     -H "X-AWS-Secret-Access-Key: YOUR_SECRET" \
    "http://YOUR_VM_IP:8080/api/incidents?topology=test&minutes=1440"
```

---

**Summary:** Your credentials stay safe on your local machine. They're encrypted in browser storage and sent securely with each request. Your VM never stores them. 🔒
