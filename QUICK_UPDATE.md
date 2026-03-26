# Quick Update Guide: Local Credentials Approach

## **What Changed**

Your architecture now keeps AWS credentials on your local machine instead of the VM.

### **Before** ❌

```
Local Browser → VM (with .env containing AWS creds)
```

### **After** ✅

```
Local Browser (credentials stored locally) → Send with request → VM (stateless)
```

---

## **1. Update Backend VM (5 minutes)**

You can **optionally remove** the `.env` file with credentials:

```bash
ssh your-vm
cd ~/chaos-backend

# Option A: Remove it entirely (cleanest)
rm .env

# Option B: Keep as backup but the service won't use it
mv .env .env.backup
```

**That's it!** The service already accepts credentials from request headers.

> **Note**: The backend service was updated to accept `X-AWS-Access-Key-Id` and `X-AWS-Secret-Access-Key` headers instead of requiring `.env`

---

## **2. Reload Chrome Extension**

Go to `chrome://extensions/` and reload your CHAOS extension.

---

## **3. Configure Credentials in Extension**

When you open the CHAOS popup:

1. Click **⚙️ Settings** button
2. Enter your AWS credentials:
   - AWS Access Key ID
   - AWS Secret Access Key
   - AWS Region (default: us-east-1)
   - Backend URL (e.g., `http://YOUR_VM_IP:8080`)
3. Click **💾 Save**

Your credentials are now stored locally in your browser - **not on the VM**.

---

## **4. Test It**

Try searching for incidents. The extension will:

1. Read credentials from local storage
2. Send them with your request
3. Backend uses them to query DynamoDB
4. Results displayed in popup

✅ Done!

---

## **Key Points**

| What                     | Before                | After                          |
| ------------------------ | --------------------- | ------------------------------ |
| Where credentials stored | VM `.env` file        | Your browser (local storage)   |
| VM security              | Stores credentials    | Stateless, no credentials      |
| Setup complexity         | Add `.env` to VM      | Add settings in extension      |
| Credential sharing       | Hard to change        | Easy - just update in Settings |
| Security                 | Credentials on server | Credentials on client only     |

---

## **Troubleshooting**

❌ **"AWS credentials not configured"**  
✅ Open Settings and add your AWS keys

❌ **"401 Unauthorized"**  
✅ Your Access Key or Secret Key is incorrect - verify in Settings

❌ **"Cannot connect to backend"**  
✅ Check Backend URL in Settings matches your VM IP

---

## **Reverting (If Needed)**

If you want to go back to storing credentials on VM:

1. Create `.env` file on VM with credentials
2. In extension Settings, leave AWS credential fields empty
3. Backend will use `.env` as fallback

But recommended: **Keep credentials on your local machine for better security!** 🔒

---

**Next:** Read [CREDENTIALS_SETUP.md](CREDENTIALS_SETUP.md) for detailed security notes and troubleshooting.
