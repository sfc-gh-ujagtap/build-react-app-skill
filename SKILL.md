---
name: build-react-app-skill
description: Build and Deploy React/Next.js apps to Snowflake
---

# Build and Deploy React/Next.js App to Snowflake SPCS

## Overview
This skill guides you through building a Next.js application from scratch and deploying it to Snowflake using Snowpark Container Services (SPCS).
---

## Step 1: Understand Requirements

Before writing any code, clarify with the user:
- What data should the app use? (Search for tables/views in their Snowflake account using `snowflake_object_search`)
- Any specific UI preferences? (Colors, layout, branding)

Note: Always connect to real Snowflake tables rather than using mock/sample data. If the user hasn't specified tables, help them find relevant ones in their account.
---

## Step 2: Create Next.js Project

```bash
# Create new Next.js project with TypeScript and Tailwind
npx create-next-app@latest <app-name> --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"

cd <app-name>
```

### Install Dependencies

```bash
# Initialize shadcn/ui
npx shadcn@latest init

# Add shadcn components as needed
npx shadcn@latest add card button table chart

# Additional visualization and utilities
npm install recharts lucide-react

# Snowflake connector (if connecting to live data)
npm install snowflake-sdk
```

### Configure next.config.js for Containerization

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['snowflake-sdk'],
  },
}
module.exports = nextConfig
```

---

## Step 3: Build the Application

### Project Structure
```
<app-name>/
├── app/
│   ├── page.tsx          # Main dashboard/page
│   ├── layout.tsx        # Root layout
│   ├── globals.css       # Global styles
│   └── api/              # API routes (if needed)
├── components/
│   └── ui/               # Reusable UI components
├── lib/
│   ├── data.ts           # Data fetching/generation
│   ├── snowflake.ts      # Snowflake connection (optional)
│   └── utils.ts          # Utility functions
├── Dockerfile
├── service-spec.yaml
└── next.config.js
```

### Create UI Components

### Data Fetching

All data should come from real Snowflake tables via:
- Server-side API routes using `snowflake-sdk`
- Direct queries to user's Snowflake tables

```typescript
// lib/snowflake.ts - Connection setup
import snowflake from 'snowflake-sdk';

export async function querySnowflake(sql: string) {
  const connection = snowflake.createConnection({
    // Use environment variables or SPCS token
  });
  // Execute query and return real data
}
```

When running in SPCS, use the injected OAuth token:
```typescript
const token = fs.readFileSync('/snowflake/session/token', 'utf8');
snowflake.createConnection({
  token: token,
  authenticator: 'oauth',
  // ...
});
```

## Step 4: Test Locally (REQUIRED)

**CRITICAL: Always test locally before deploying to SPCS.**

### Start Development Server

```bash
cd <app-name>
npm run dev
```

The app will run at `http://localhost:3000`

### Verify Using Browser Tool

Use `ai_browser` tool to test the application:
```
ai_browser(
  initial_url="http://localhost:3000",
  instructions="Verify the dashboard loads correctly. Check that all charts render, metrics display, and the layout is responsive."
)
```

### Test Checklist
- [ ] Page loads without errors
- [ ] All charts/visualizations render
- [ ] Data displays correctly
- [ ] Responsive design works
- [ ] No console errors

### Build Test

```bash
npm run build
```

Fix any build errors before proceeding. Note: During `npm run build`, Snowflake connection errors are expected since there's no OAuth token at build time - routes will work at runtime.

### **USER CONFIRMATION REQUIRED**

**STOP HERE AND WAIT FOR USER CONFIRMATION.**

After local testing, emit the localhost URL and explicitly ask the user:

```
The app is running at http://localhost:3000

Please review the application and confirm it looks good before I proceed with Snowflake SPCS deployment.

Do you want me to proceed with deployment? (yes/no)
```

**DO NOT proceed to Step 5 until the user explicitly confirms the app looks correct.**

---

## Step 5: Check SPCS Prerequisites

Run these checks IN ORDER. Stop and resolve before proceeding.

### Check Current Role

```sql
SELECT CURRENT_ROLE(), CURRENT_USER();
```

If you need SPCS privileges:
```sql
USE ROLE <role_with_spcs_access>;  -- e.g., ACCOUNTADMIN
```

### Check/Create Compute Pool

```sql
SHOW COMPUTE POOLS;
```

**If no usable pool exists:**
```sql
CREATE COMPUTE POOL <pool_name>
  MIN_NODES = 1
  MAX_NODES = 1
  INSTANCE_FAMILY = CPU_X64_XS;
```

**If pool is SUSPENDED:**
```sql
ALTER COMPUTE POOL <pool_name> RESUME;
```

### Check/Create Image Repository

```sql
SHOW IMAGE REPOSITORIES;
```

**If no repository exists:**
```sql
CREATE DATABASE IF NOT EXISTS <db>;
CREATE SCHEMA IF NOT EXISTS <db>.<schema>;
CREATE IMAGE REPOSITORY <db>.<schema>.<repo_name>;
```

Get the registry URL from `repository_url` column.

### Verify Local Environment

```bash
# Docker running?
docker info > /dev/null 2>&1 && echo "Docker OK" || echo "FAIL: Start Docker Desktop"

# Login to Snowflake registry
snow spcs image-registry login --connection <conn>
```

---

## Step 6: Create Dockerfile

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:18-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
```

---

## Step 7: Create Service Specification

Create `service-spec.yaml`:

```yaml
spec:
  containers:
  - name: <app-name>
    image: /<db>/<schema>/<repo>/<image>:latest
    env:
      HOSTNAME: "0.0.0.0"  # Required! Without this, service shows READY but returns "connection refused"
      PORT: "8080"
      NODE_ENV: production
    resources:
      requests:
        memory: 1Gi
        cpu: 500m
      limits:
        memory: 2Gi
        cpu: 1000m
    readinessProbe:
      port: 8080
      path: /
  endpoints:
  - name: <endpoint-name>
    port: 8080
    public: true
```

---

## Step 8: Build and Push Docker Image

```bash
# Build for linux/amd64 (required for SPCS)
docker build --platform linux/amd64 -t <image-name>:latest .

# Tag with full registry path
docker tag <image-name>:latest <registry-url>/<db>/<schema>/<repo>/<image-name>:latest

# Push to Snowflake registry
docker push <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
```

Registry URL format: `<orgname>-<acctname>.registry.snowflakecomputing.com`

---

## Step 9: Deploy to SPCS

```sql
CREATE SERVICE <service_name>
  IN COMPUTE POOL <pool_name>
  FROM SPECIFICATION $$
  <contents of service-spec.yaml>
  $$;
```

### Monitor Deployment

```sql
-- Check status (wait for READY)
SELECT SYSTEM$GET_SERVICE_STATUS('<service_name>');

-- Get logs if issues
CALL SYSTEM$GET_SERVICE_LOGS('<service_name>', '0', '<container-name>', 100);

-- Get public URL
SHOW ENDPOINTS IN SERVICE <service_name>;
```

---

## Step 10: Verify Deployed Application

Use `ai_browser` to verify the deployed app works:
```
ai_browser(
  initial_url="https://<ingress_url>",
  instructions="Verify the dashboard loads correctly in production."
)
```

---

## Updating the Application

After making code changes:

```bash
# Rebuild and push
docker build --platform linux/amd64 -t <image-name>:latest .
docker tag <image-name>:latest <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
docker push <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
```

```sql
-- Force service to pull new image (SUSPEND/RESUME won't work for image updates!)
ALTER SERVICE <service_name> FROM SPECIFICATION $$
<full yaml spec>
$$;
```

---

## Quick Reference

| Step | Command/Action |
|------|----------------|
| Create project | `npx create-next-app@latest <name> --typescript --tailwind --app` |
| Install deps | `npm install recharts lucide-react` |
| Test locally | `npm run dev` → verify at localhost:3000 |
| Build | `npm run build` |
| Docker build | `docker build --platform linux/amd64 -t <img>:latest .` |
| Push image | `docker push <registry>/<db>/<schema>/<repo>/<img>:latest` |
| Deploy | `CREATE SERVICE ... FROM SPECIFICATION ...` |
| Check status | `SELECT SYSTEM$GET_SERVICE_STATUS('<svc>')` |
| Get URL | `SHOW ENDPOINTS IN SERVICE <svc>` |
| Update | `ALTER SERVICE <svc> FROM SPECIFICATION ...` |
