# Quick Guide: Setting Up Aiven Cloud for Testing

This is a quick reference guide for setting up Aiven Cloud services for your Manage Time app.

## 🎯 Quick Start

### 1. Create Aiven Account
- Go to [https://console.aiven.io](https://console.aiven.io)
- Sign up (free trial available)

### 2. Create PostgreSQL Service

**Steps:**
1. Click **"Create service"** or **"New service"**
2. Service type: **PostgreSQL**
3. Cloud provider: Choose closest region (e.g., AWS us-east-1)
4. Service plan: **Startup-4** (good for testing, ~$19/month)
5. Service name: `manage-time-db`
6. Click **"Create service"**

**Wait 2-5 minutes for service to be ready**

**Get Connection String:**
1. Click on your PostgreSQL service
2. Go to **"Connection information"** tab
3. Copy the **"Connection string"** (Service URI)
4. It looks like: `postgresql://avnadmin:password@host:port/defaultdb?sslmode=require`

**Update `.env`:**
```env
DATABASE_URL="postgresql://avnadmin:YOUR_PASSWORD@YOUR_HOST.aivencloud.com:12345/defaultdb?sslmode=require"
```

### 3. Create Valkey Service (Redis-Compatible)

**Important:** Aiven no longer offers Redis directly. Use **Valkey** instead - it's 100% Redis-compatible and works with your app without any code changes!

**Steps:**
1. Click **"Create service"** again
2. Service type: **Valkey** (blue hexagonal icon with 'V' - described as "High-performance key/value datastore")
3. Cloud provider: Same region as PostgreSQL
4. Service plan: **Startup-4** (~$19/month)
5. Service name: `manage-time-redis`
6. Click **"Create service"`

**Wait 2-5 minutes for service to be ready**

**Get Connection String:**
1. Click on your Valkey service
2. Go to **"Connection information"** tab
3. Copy the **"Connection string"**
4. It looks like: `redis://avnadmin:password@host:port`

**Update `.env`:**
```env
REDIS_URL="redis://avnadmin:YOUR_PASSWORD@YOUR_VALKEY_HOST.aivencloud.com:12345"
```

**Note:** If Valkey connection fails, try with SSL:
```env
REDIS_URL="rediss://avnadmin:YOUR_PASSWORD@YOUR_VALKEY_HOST.aivencloud.com:12345"
```
(Notice `rediss://` instead of `redis://`)

**Why Valkey?** Valkey is a fork of Redis and is fully compatible with Redis clients. Your application will work exactly the same!

## 🔧 Complete .env Configuration

After setting up Aiven, your `.env` file should have:

```env
# Aiven PostgreSQL
DATABASE_URL="postgresql://avnadmin:YOUR_PASSWORD@YOUR_HOST.aivencloud.com:12345/defaultdb?sslmode=require"

# Aiven Valkey (Redis-compatible)
REDIS_URL="redis://avnadmin:YOUR_PASSWORD@YOUR_VALKEY_HOST.aivencloud.com:12345"

# JWT Secrets (generate new ones!)
JWT_SECRET="generate-with-openssl-rand-base64-32"
JWT_REFRESH_SECRET="generate-another-secret"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# Server
PORT=3000
NODE_ENV="production"
CORS_ORIGIN="https://your-frontend.com"

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Optional: OpenAI
OPENAI_API_KEY="sk-your-key-here"
OPENAI_MODEL="gpt-4o-mini"

# Optional: Email (if using)
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT=587
SMTP_SECURE="false"
SMTP_USER="apikey"
SMTP_PASS="your-sendgrid-key"
SMTP_FROM="noreply@yourdomain.com"
FRONTEND_URL="https://your-frontend.com"
```

## 🗄️ Run Database Migrations

After setting up the database:

```bash
cd backend

# Generate Prisma client
npm run db:generate

# Run migrations
npx prisma migrate deploy
```

## ✅ Test Connection

```bash
# Build the app
npm run build

# Start the server
npm start
```

You should see:
```
Database connected successfully
Redis connected successfully
Job queues initialized
Server running on port 3000
```

## 💰 Cost Estimate

For testing:
- PostgreSQL Startup-4: ~$19/month
- Redis Startup-4: ~$19/month
- **Total: ~$38/month**

You can downgrade to smaller plans later or use the free tier if available.

## 🔐 Security Notes

1. **Never commit `.env` file to Git**
2. **Change default passwords** - Aiven generates strong passwords, keep them secure
3. **Use SSL** - Aiven uses SSL by default (`sslmode=require`)
4. **Restrict IP access** - In Aiven console, you can restrict which IPs can connect
5. **Enable backups** - Aiven offers automated backups (configure in service settings)

## 🆘 Common Issues

### "Can't reach database server"
- Check if service is running in Aiven console
- Verify connection string is correct
- Check your network/firewall

### "Authentication failed"
- Double-check username and password
- Make sure you're using the correct database name

### "SSL required"
- Aiven requires SSL, make sure `?sslmode=require` is in your connection string

### Redis connection timeout
- Try using `rediss://` (SSL) instead of `redis://`
- Check if Redis service is running
- Verify connection string format

## 📞 Need Help?

- Aiven Support: [https://help.aiven.io](https://help.aiven.io)
- Aiven Docs: [https://docs.aiven.io](https://docs.aiven.io)
- Check service status in Aiven console

---

**Next Steps:**
1. ✅ Set up Aiven PostgreSQL
2. ✅ Set up Aiven Valkey (Redis-compatible)
3. ✅ Update `.env` file
4. ✅ Run migrations
5. ✅ Test connection
6. 🚀 Deploy your app!

