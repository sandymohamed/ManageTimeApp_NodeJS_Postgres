# Deployment Guide for Manage Time App

This guide will help you deploy the Manage Time backend API to production, including setting up Aiven Cloud for PostgreSQL and Redis.

## 📋 Pre-Deployment Checklist

### ✅ Code Readiness
- [x] All features implemented and tested
- [x] TypeScript compilation successful (`npm run build`)
- [x] Database migrations are up to date
- [x] Environment variables documented
- [x] Error handling in place
- [x] Logging configured

### ⚠️ Before Deploying
- [ ] Review and update all environment variables
- [ ] Generate strong JWT secrets
- [ ] Set up production database (Aiven Cloud)
- [ ] Set up production Redis (Aiven Cloud or alternative)
- [ ] Configure CORS origins for production
- [ ] Set up email service (if using email features)
- [ ] Configure Firebase (if using push notifications)
- [ ] Set up AWS S3 (if using file uploads)

---

## 🚀 Step 1: Set Up Aiven Cloud Database

### 1.1 Create Aiven Account
1. Go to [https://console.aiven.io](https://console.aiven.io)
2. Sign up or log in to your account

### 1.2 Create PostgreSQL Service
1. Click **"Create service"** or **"New service"**
2. Select **PostgreSQL** as the service type
3. Choose your cloud provider and region (e.g., AWS, Google Cloud, Azure)
4. Select a service plan (start with **Startup-4** for testing, upgrade later)
5. Enter a service name (e.g., `manage-time-db`)
6. Click **"Create service"**

### 1.3 Get Connection String
1. Wait for the service to be created (takes 2-5 minutes)
2. Go to your PostgreSQL service overview
3. Click on **"Connection information"** or **"Service URI"**
4. Copy the **"Connection string"** (it looks like: `postgresql://avnadmin:password@host:port/defaultdb?sslmode=require`)

### 1.4 Update Database URL
Update your `.env` file with the Aiven connection string:
```env
DATABASE_URL="postgresql://avnadmin:your-password@your-host.aivencloud.com:12345/defaultdb?sslmode=require"
```

**Important Notes:**
- Aiven uses SSL by default (`sslmode=require`)
- The default database is usually `defaultdb`
- You can create a new database using Aiven console or via SQL

### 1.5 Create Application Database (Optional)
If you want a custom database name instead of `defaultdb`:

1. Go to Aiven console → Your PostgreSQL service
2. Click on **"Databases"** tab
3. Click **"Create database"**
4. Enter database name: `manage_time_db`
5. Update your `DATABASE_URL`:
```env
DATABASE_URL="postgresql://avnadmin:your-password@your-host.aivencloud.com:12345/manage_time_db?sslmode=require"
```

---

## 🔴 Step 2: Set Up Valkey (Redis-Compatible) on Aiven Cloud

**Important:** Aiven no longer offers Redis directly. Instead, they provide **Valkey**, which is a Redis-compatible fork. Your application will work with Valkey without any code changes!

### 2.1 Create Valkey Service
1. In Aiven console, click **"Create service"**
2. Select **Valkey** as the service type (look for the blue hexagonal icon with 'V')
3. Choose cloud provider and region (same as PostgreSQL for lower latency)
4. Select a service plan (start with **Startup-4** for testing)
5. Enter a service name (e.g., `manage-time-redis`)
6. Click **"Create service"**

**Note:** Valkey is 100% Redis-compatible, so you can use it exactly like Redis. No code changes needed!

### 2.2 Get Valkey Connection String
1. Wait for the service to be created (2-5 minutes)
2. Go to your Valkey service overview
3. Click on **"Connection information"**
4. Copy the **"Connection string"** (it looks like: `redis://avnadmin:password@host:port`)

### 2.3 Update Redis URL
Update your `.env` file with the Valkey connection string:
```env
REDIS_URL="redis://avnadmin:your-password@your-valkey-host.aivencloud.com:12345"
```

**Note:** Aiven Valkey may require SSL. If you get connection errors, try:
```env
REDIS_URL="rediss://avnadmin:your-password@your-valkey-host.aivencloud.com:12345"
```
(The `rediss://` protocol indicates SSL/TLS)

**Alternative Options:**
- **Dragonfly**: Another in-memory data store option (also Redis-compatible)
- **Aiven for Caching**: Deprecated, not recommended

---

## 🔐 Step 3: Configure Environment Variables

### 3.1 Create Production .env File
1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

### 3.2 Generate JWT Secrets
Generate strong secrets for production:
```bash
# On Linux/Mac
openssl rand -base64 32

# On Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
```

Update your `.env`:
```env
JWT_SECRET="<generated-secret-1>"
JWT_REFRESH_SECRET="<generated-secret-2>"
```

### 3.3 Update Server Configuration
```env
NODE_ENV="production"
PORT=3000
CORS_ORIGIN="https://your-production-frontend.com,https://www.your-production-frontend.com"
```

### 3.4 Optional Services
Configure if you're using these features:

**Email (for project invitations):**
```env
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT=587
SMTP_SECURE="false"
SMTP_USER="apikey"
SMTP_PASS="your-sendgrid-api-key"
SMTP_FROM="noreply@yourdomain.com"
FRONTEND_URL="https://your-production-frontend.com"
```

**OpenAI (for AI features):**
```env
OPENAI_API_KEY="sk-your-openai-api-key"
OPENAI_MODEL="gpt-4o-mini"
```

---

## 🗄️ Step 4: Run Database Migrations

### 4.1 Install Dependencies
```bash
cd backend
npm install
```

### 4.2 Generate Prisma Client
```bash
npm run db:generate
```

**⚠️ Windows Permission Error?** If you get `EPERM: operation not permitted` error on Windows:

**Solution 1: Close all Node processes**
```powershell
# Close all Node.js processes
Get-Process node | Stop-Process -Force

# Then try again
npm run db:generate
```

**Solution 2: Delete Prisma client and regenerate**
```powershell
# Delete the Prisma client folder
Remove-Item -Recurse -Force node_modules\.prisma -ErrorAction SilentlyContinue

# Try generating again
npm run db:generate
```

**Solution 3: Run PowerShell as Administrator**
1. Right-click PowerShell
2. Select "Run as Administrator"
3. Navigate to your project: `cd E:\manage_time_app\backend`
4. Run: `npm run db:generate`

**Solution 4: Temporarily disable antivirus**
- Some antivirus software locks DLL files
- Temporarily disable real-time protection
- Run `npm run db:generate`
- Re-enable antivirus

### 4.3 Run Migrations
For production, use `migrate deploy` (doesn't create new migrations):
```bash
npm run db:migrate
# Or for production: 
npx prisma migrate deploy
```

This will create all necessary tables in your Aiven PostgreSQL database.

### 4.4 Verify Database Connection
Test the connection:
```bash
npx prisma studio
```
This opens Prisma Studio where you can view your database.

---

## 🏗️ Step 5: Build and Test

### 5.1 Build TypeScript
```bash
npm run build
```

### 5.2 Test Locally with Production Database
```bash
# Make sure your .env is configured with Aiven credentials
npm start
```

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

### 5.3 Test Database Connection
The server should log:
```
Database connected successfully
Redis connected successfully
Job queues initialized
Server running on port 3000
```

---

## 🌐 Step 6: Deploy to Hosting Platform

### Option A: Deploy to Heroku
1. Install Heroku CLI
2. Login: `heroku login`
3. Create app: `heroku create manage-time-api`
4. Set environment variables:
```bash
heroku config:set DATABASE_URL="your-aiven-postgres-url"
heroku config:set REDIS_URL="your-aiven-redis-url"
heroku config:set JWT_SECRET="your-jwt-secret"
heroku config:set JWT_REFRESH_SECRET="your-refresh-secret"
# ... set all other variables
```
5. Deploy: `git push heroku main`
6. Run migrations: `heroku run npx prisma migrate deploy`

### Option B: Deploy to Railway
1. Connect your GitHub repo to Railway
2. Add environment variables in Railway dashboard
3. Railway will auto-detect and deploy
4. Run migrations via Railway CLI or dashboard

### Option C: Deploy to DigitalOcean App Platform
1. Connect GitHub repo
2. Configure build command: `npm run build`
3. Configure start command: `npm start`
4. Add all environment variables
5. Deploy

### Option D: Deploy to AWS EC2 / Google Cloud / Azure
1. Set up VM instance
2. Install Node.js 18+
3. Clone repository
4. Install dependencies: `npm ci --production`
5. Set environment variables
6. Build: `npm run build`
7. Run migrations: `npx prisma migrate deploy`
8. Start with PM2: `pm2 start dist/index.js --name manage-time-api`
9. Set up reverse proxy (nginx)

---

## 🔍 Step 7: Post-Deployment Verification

### 7.1 Health Check
```bash
curl https://your-api-domain.com/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456
}
```

### 7.2 Test API Endpoints
```bash
# Register a test user
curl -X POST https://your-api-domain.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!","name":"Test User"}'

# Login
curl -X POST https://your-api-domain.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'
```

### 7.3 Monitor Logs
Check application logs for any errors:
- Database connection issues
- Redis connection issues
- Authentication errors
- API errors

---

## 🔒 Security Checklist

- [ ] All environment variables are set (no defaults in production)
- [ ] JWT secrets are strong and unique
- [ ] Database uses SSL (`sslmode=require`)
- [ ] Redis uses SSL if available
- [ ] CORS origins are restricted to production domains
- [ ] Rate limiting is enabled
- [ ] Helmet security headers are enabled
- [ ] No sensitive data in logs
- [ ] API keys are stored securely (not in code)
- [ ] Database credentials are secure

---

## 📊 Monitoring

### Aiven Cloud Monitoring
- Monitor database performance in Aiven console
- Set up alerts for high CPU/memory usage
- Monitor connection pool usage
- Check slow query logs
- Monitor Valkey (Redis) performance and memory usage

### Application Monitoring
- Set up error tracking (Sentry, LogRocket, etc.)
- Monitor API response times
- Track database query performance
- Monitor Redis cache hit rates

---

## 🆘 Troubleshooting

### Prisma Generate Permission Error (Windows)
**Error:** `EPERM: operation not permitted, rename '...query_engine-windows.dll.node'`

This happens when the Prisma query engine DLL is locked by another process.

**Quick Fixes:**
1. **Close all Node processes:**
   ```powershell
   Get-Process node | Stop-Process -Force
   npm run db:generate
   ```

2. **Delete and regenerate Prisma client:**
   ```powershell
   Remove-Item -Recurse -Force node_modules\.prisma -ErrorAction SilentlyContinue
   npm run db:generate
   ```

3. **Run PowerShell as Administrator:**
   - Right-click PowerShell → "Run as Administrator"
   - Navigate to project and run `npm run db:generate`

4. **Temporarily disable antivirus:**
   - Some antivirus software locks DLL files during installation
   - Disable real-time protection temporarily
   - Run `npm run db:generate`
   - Re-enable antivirus

### Database Connection Issues
**Error:** `P1001: Can't reach database server`
- Check if Aiven service is running
- Verify connection string is correct
- Check firewall/network settings
- Ensure SSL is enabled (`sslmode=require`)

**Error:** `P1000: Authentication failed`
- Verify username and password
- Check if database name is correct
- Ensure user has proper permissions

### Valkey/Redis Connection Issues
**Error:** `Redis connection error`
- Verify Valkey URL is correct
- Try using `rediss://` instead of `redis://` (SSL)
- Check if Valkey service is running
- Verify network connectivity
- Remember: Valkey is Redis-compatible, so it uses the same connection format

### Migration Issues
**Error:** `Migration failed`
- Check database connection
- Verify Prisma schema matches migrations
- Run `npx prisma migrate resolve` if needed
- Check migration history: `npx prisma migrate status`

---

## 📝 Environment Variables Summary

### Required Variables
| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:port/db?sslmode=require` |
| `REDIS_URL` | Valkey/Redis connection string | `redis://user:pass@host:port` |
| `JWT_SECRET` | JWT signing secret | `base64-encoded-secret` |
| `JWT_REFRESH_SECRET` | JWT refresh secret | `base64-encoded-secret` |
| `NODE_ENV` | Environment mode | `production` |
| `PORT` | Server port | `3000` |

### Optional Variables
| Variable | Description | Required For |
|----------|-------------|--------------|
| `OPENAI_API_KEY` | OpenAI API key | AI features |
| `SMTP_*` | Email configuration | Email notifications |
| `FIREBASE_*` | Firebase config | Push notifications |
| `AWS_*` | AWS S3 config | File uploads |
| `CORS_ORIGIN` | Allowed origins | CORS configuration |

---

## 🎉 You're Ready!

Your application should now be deployed and ready for testing. Make sure to:
1. Test all critical features
2. Monitor logs for errors
3. Set up backups for your Aiven database
4. Configure monitoring and alerts
5. Update your mobile app to point to the production API URL

---

## 📚 Additional Resources

- [Aiven Documentation](https://docs.aiven.io/)
- [Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment)
- [Node.js Production Best Practices](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/)

---

**Need Help?** Check the logs, review error messages, and consult the troubleshooting section above.

