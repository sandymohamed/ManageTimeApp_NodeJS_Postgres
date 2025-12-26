# Railway Deployment Guide

## Fixed Issues

### Build Configuration
- ✅ **Fixed `package.json` scripts**: Separated build from start command
  - `build`: Only compiles TypeScript (`tsc`)
  - `start`: Only runs the built app (`node dist/index.js`)
  - `postinstall`: Generates Prisma Client automatically after `npm install`

- ✅ **Fixed Dockerfile**: Production stage now correctly runs pre-built app
  - Builds TypeScript in builder stage
  - Production stage copies built files and runs the app directly
  - Added health check endpoint
  - Properly handles Prisma Client generation

### Railway Deployment Process

Railway will automatically:
1. Run `npm install` (triggers `postinstall` → generates Prisma Client)
2. Run `npm run build` (compiles TypeScript to JavaScript)
3. Run `npm start` (starts the server with `node dist/index.js`)

OR if using Dockerfile:
1. Builds the Docker image using multi-stage build
2. Runs the production container

## Required Environment Variables

Make sure these are set in Railway:

### Required
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis/Valkey connection string
- `JWT_SECRET` - JWT signing secret
- `JWT_REFRESH_SECRET` - JWT refresh token secret
- `PORT` - Server port (Railway sets this automatically)

### Optional but Recommended
- `NODE_ENV=production`
- `CORS_ORIGIN` - Comma-separated list of allowed origins
- `OPENAI_API_KEY` - For AI features
- `SMTP_*` - Email configuration
- `FIREBASE_*` - Firebase credentials

## Database Migrations

**Important**: After deployment, you need to run database migrations:

```bash
# Via Railway CLI
railway run npx prisma migrate deploy

# OR add this to your deployment process
```

You can also add a migration script to run automatically on deploy.

## Health Check

The application includes a `/health` endpoint that Railway can use for health checks:
- Endpoint: `GET /health`
- Returns: `{ status: 'ok', timestamp: ..., uptime: ... }`

## Troubleshooting

### Service Shows as Offline
1. Check Railway deployment logs for build errors
2. Verify all required environment variables are set
3. Ensure database migrations have been run
4. Check that the `/health` endpoint is accessible
5. Verify PORT environment variable is set (Railway sets this automatically)

### Build Fails
- Ensure `DATABASE_URL` is set (Prisma needs it during generation)
- Check that all dependencies are correctly listed in `package.json`
- Verify TypeScript compilation has no errors

### Runtime Errors
- Check logs in Railway dashboard
- Verify database connection string is correct
- Ensure Redis connection string is correct
- Check that all required environment variables are present

## Deployment Checklist

- [ ] All environment variables configured in Railway
- [ ] Database migrations run (`npx prisma migrate deploy`)
- [ ] Build completes successfully
- [ ] Health endpoint accessible at `/health`
- [ ] Service shows as "Active" in Railway dashboard
- [ ] API endpoints responding correctly

