# Railway Environment Variables Checklist

## Required for Shopify App
- SHOPIFY_API_KEY
- SHOPIFY_API_SECRET
- SHOPIFY_SCOPES
- SHOPIFY_APP_URL
- DATABASE_URL (for Prisma)

## Required for Advanced Store (Cron Job)
- ADVANCED_STORE_DOMAIN
- ADVANCED_STORE_ADMIN_TOKEN

## Required for Monitor API
- MONITOR_URL
- MONITOR_USER
- MONITOR_PASS
- MONITOR_COMPANY

## Railway Specific
- PORT (automatically set by Railway)
- HOST (automatically set to 0.0.0.0)

## Notes for Railway Configuration:
1. Railway will automatically use the "start" script from package.json
2. The concurrently command runs both the web server and the cron worker
3. Make sure all environment variables are set in Railway's dashboard
4. The cron job will only run if ADVANCED_STORE_DOMAIN and ADVANCED_STORE_ADMIN_TOKEN are present
