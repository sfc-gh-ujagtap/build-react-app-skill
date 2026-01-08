---
name: build-react-app-skill
description: Build and Deploy React/Next.js apps to Snowflake
---

# Build and Deploy React/Next.js App to Snowflake SPCS

## Overview
This skill guides you through building a Next.js application and deploying it to Snowflake using Snowpark Container Services (SPCS).

**Authentication:**
- **Local development:** External Browser (SSO) - opens browser for login, zero setup
- **Production (SPCS):** OAuth token - automatic, no setup needed

---

## Step 1: Understand Requirements

Before writing any code, clarify with the user:
- What data should the app use? (Search for tables/views using `snowflake_object_search`)
- Any specific UI preferences? (Colors, layout, branding)

**CRITICAL: NEVER use mock/hardcoded data. Always connect to real Snowflake tables.**

---

## Step 2: Create Next.js Project

```bash
npx create-next-app@latest <app-name> --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"
cd <app-name>
```

### Install Dependencies

```bash
npm install recharts lucide-react clsx tailwind-merge snowflake-sdk
```

### Configure next.config.ts

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["snowflake-sdk"],
};

export default nextConfig;
```

---

## Step 3: Build the Application

### Project Structure
```
<app-name>/
├── app/
│   ├── page.tsx
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
├── components/
├── lib/
│   ├── snowflake.ts      # Snowflake connection (REQUIRED)
│   └── utils.ts
├── Dockerfile
├── service-spec.yaml
└── next.config.ts
```

### Create Snowflake Connection (lib/snowflake.ts)

```typescript
import snowflake from "snowflake-sdk";
import fs from "fs";

let connection: snowflake.Connection | null = null;
let connectionPromise: Promise<snowflake.Connection> | null = null;

snowflake.configure({ logLevel: "ERROR" });

async function getConnection(): Promise<snowflake.Connection> {
  if (connection) {
    return connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    let connConfig: snowflake.ConnectionOptions;
    let useAsyncConnect = false;

    // SPCS environment - use OAuth token
    const tokenPath = "/snowflake/session/token";
    if (fs.existsSync(tokenPath)) {
      const token = fs.readFileSync(tokenPath, "utf8");
      const host = process.env.SNOWFLAKE_HOST || "";
      connConfig = {
        accessUrl: `https://${host}`,
        account: host.split(".")[0] || "snowflake",
        authenticator: "OAUTH",
        token: token,
        warehouse: process.env.SNOWFLAKE_WAREHOUSE || "COMPUTE_WH",
        database: process.env.SNOWFLAKE_DATABASE || "<database>",
        schema: process.env.SNOWFLAKE_SCHEMA || "<schema>",
      };
    } else {
      // Local development - External Browser (SSO)
      connConfig = {
        account: process.env.SNOWFLAKE_ACCOUNT || "<account>",
        username: process.env.SNOWFLAKE_USER || "<username>",
        authenticator: "EXTERNALBROWSER",
        warehouse: process.env.SNOWFLAKE_WAREHOUSE || "<warehouse>",
        database: process.env.SNOWFLAKE_DATABASE || "<database>",
        schema: process.env.SNOWFLAKE_SCHEMA || "<schema>",
      };
      useAsyncConnect = true;
    }

    const conn = snowflake.createConnection(connConfig);

    if (useAsyncConnect) {
      await conn.connectAsync(() => {});
      connection = conn;
    } else {
      connection = await new Promise<snowflake.Connection>((resolve, reject) => {
        conn.connect((err, connResult) => {
          if (err) {
            console.error("Snowflake connection error:", err.message);
            reject(err);
          } else {
            resolve(connResult);
          }
        });
      });
    }

    return connection;
  })();

  return connectionPromise;
}

export async function querySnowflake<T>(sql: string): Promise<T[]> {
  const conn = await getConnection();
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      complete: (err, stmt, rows) => {
        if (err) {
          console.error("Query error:", err.message);
          reject(err);
        } else {
          resolve((rows || []) as T[]);
        }
      },
    });
  });
}
```

**Note:** On first API request locally, a browser window opens for SSO login. Connection is cached for subsequent requests.

### Create API Routes

**All API routes MUST query real Snowflake data:**

```typescript
// app/api/data/route.ts
import { NextResponse } from "next/server";
import { querySnowflake } from "@/lib/snowflake";

export async function GET() {
  try {
    const results = await querySnowflake<{ COL1: string; COL2: number }>(`
      SELECT COL1, COL2 
      FROM <DATABASE>.<SCHEMA>.<TABLE>
      LIMIT 100
    `);
    return NextResponse.json(results);
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
```

---

## Step 4: Test Locally (REQUIRED)

```bash
npm run dev
```

App runs at `http://localhost:3000`. Browser opens for SSO on first API request.

### Verify Using Browser Tool

```
ai_browser(
  initial_url="http://localhost:3000",
  instructions="Verify dashboard loads with REAL Snowflake data."
)
```

### Build Test

```bash
npm run build
```

### **USER CONFIRMATION REQUIRED**

**STOP HERE.** Ask user to confirm the app looks correct before SPCS deployment.

---

## Step 5: Check SPCS Prerequisites

### Check Current Role

```sql
SELECT CURRENT_ROLE(), CURRENT_USER();
```

### Check/Create Compute Pool

```sql
-- List pools accessible to current role (check 'owner' column)
SHOW COMPUTE POOLS;

-- Verify current role can use the pool (owner must match or have USAGE grant)
SELECT CURRENT_ROLE();
-- Pool owner must equal current role, OR run:
SHOW GRANTS ON COMPUTE POOL <pool_name>;

-- If no accessible pool exists, create one (will be owned by current role):
CREATE COMPUTE POOL <pool_name>
  MIN_NODES = 1
  MAX_NODES = 1
  INSTANCE_FAMILY = CPU_X64_XS;
```

**IMPORTANT:** You can only use compute pools owned by your current role or where you have USAGE privilege. If `CREATE SERVICE` fails with "not authorized", switch to a pool your role owns.

### Check/Create Image Repository

```sql
SHOW IMAGE REPOSITORIES;

-- If needed:
CREATE IMAGE REPOSITORY <db>.<schema>.<repo_name>;
```

### Login to Registry

```bash
snow spcs image-registry login --connection <conn>
```

---

## Step 6: Create Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
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
      HOSTNAME: "0.0.0.0"
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
docker build --platform linux/amd64 -t <image-name>:latest .
docker tag <image-name>:latest <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
docker push <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
```

---

## Step 9: Deploy to SPCS

```sql
CREATE SERVICE <service_name>
  IN COMPUTE POOL <pool_name>
  FROM SPECIFICATION $$
  <contents of service-spec.yaml>
  $$;
```

### Monitor and Get URL

```sql
SELECT SYSTEM$GET_SERVICE_STATUS('<service_name>');
SHOW ENDPOINTS IN SERVICE <service_name>;
```

---

## Step 10: Verify Deployed Application

```
ai_browser(
  initial_url="https://<ingress_url>",
  instructions="Verify dashboard loads with real Snowflake data."
)
```

---

## Updating the Application

```bash
docker build --platform linux/amd64 -t <image-name>:latest .
docker tag <image-name>:latest <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
docker push <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
```

```sql
ALTER SERVICE <service_name> FROM SPECIFICATION $$
<full yaml spec>
$$;
```

---

## Quick Reference

| Step | Command/Action |
|------|----------------|
| Create project | `npx create-next-app@latest <name> --typescript --tailwind --app` |
| Install deps | `npm install recharts lucide-react snowflake-sdk` |
| Test locally | `npm run dev` → browser opens for SSO |
| Build | `npm run build` |
| Docker build | `docker build --platform linux/amd64 -t <img>:latest .` |
| Push image | `docker push <registry>/<db>/<schema>/<repo>/<img>:latest` |
| Deploy | `CREATE SERVICE ... FROM SPECIFICATION ...` |
| Check status | `SELECT SYSTEM$GET_SERVICE_STATUS('<svc>')` |
| Get URL | `SHOW ENDPOINTS IN SERVICE <svc>` |
