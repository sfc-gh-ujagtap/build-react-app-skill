---
name: build-react-app-skill
description: Build and Deploy React/Next.js apps to Snowflake
---

# Build and Deploy React/Next.js App to Snowflake SPCS

## Overview
This skill guides you through building a Next.js application and deploying it to Snowflake using Snowpark Container Services (SPCS).

---

## Step 1: Understand Requirements

Before writing any code, clarify with the user:
- What data should the app use? (Search for tables/views using `snowflake_object_search`)
- Any specific UI preferences? (Colors, layout, branding)

**CRITICAL: NEVER use mock/hardcoded data. Always connect to real Snowflake tables.**

---

## Step 2: Prerequisites

### Node.js 20+
```bash
node --version  # Must be v20.x.x or higher
```
If below 20, install via [nodejs.org](https://nodejs.org/), Homebrew (`brew install node@20`), or nvm (`nvm install 20`).

### Docker
```bash
docker --version
```
If not installed, download from [docker.com](https://www.docker.com/products/docker-desktop/).

---

## Step 3: Create Next.js Project

```bash
npx create-next-app@latest <app-name> --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"
cd <app-name>
```

### Initialize shadcn/ui (REQUIRED)

**IMPORTANT:** Always use shadcn/ui for UI components. This ensures consistent, professional styling.

```bash
npx shadcn@latest init -d
```

This creates:
- `components/ui/` directory for shadcn components
- `lib/utils.ts` with the `cn()` helper
- Proper CSS variables in `globals.css`

### Add Required shadcn Components

```bash
npx shadcn@latest add card chart button table select input tabs badge skeleton dialog dropdown-menu separator tooltip
```

**CRITICAL for Charts:** Use `recharts@2.15.4` (the version shadcn specifies):
```bash
npm install recharts@2.15.4
```

### Install Additional Dependencies

```bash
npm install lucide-react snowflake-sdk
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

## Step 4: Connections & Authentication

### Overview

| Environment | Auth Method | How It Works |
|-------------|-------------|--------------|
| **Local Development** | External Browser (SSO) | Opens browser for login on first API request |
| **SPCS Production** | OAuth Token | Auto-injected at `/snowflake/session/token` |

### Environment Variables

| Variable | Local | SPCS | Description |
|----------|-------|------|-------------|
| `SNOWFLAKE_ACCOUNT` | Required | - | Account identifier (e.g., `xy12345.us-east-1`) |
| `SNOWFLAKE_USER` | Required | - | Your Snowflake username |
| `SNOWFLAKE_WAREHOUSE` | Required | Required | Warehouse to use for queries |
| `SNOWFLAKE_DATABASE` | Required | Required | Default database |
| `SNOWFLAKE_SCHEMA` | Required | Required | Default schema |
| `SNOWFLAKE_HOST` | - | Auto-set | SPCS host (auto-injected by SPCS) |

### How Detection Works

The app detects its environment by checking for the SPCS token file:
```typescript
function isRunningInSPCS(): boolean {
  return fs.existsSync("/snowflake/session/token");
}
```

- **Token exists** → Running in SPCS → Use OAuth with connection pool
- **No token** → Local development → Use External Browser with single connection

---

## Step 5: Build the Application

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

snowflake.configure({ logLevel: "ERROR" });

function isRunningInSPCS(): boolean {
  const tokenPath = "/snowflake/session/token";
  return fs.existsSync(tokenPath);
}

// ============ LOCAL DEVELOPMENT: Single Connection ============
let connection: snowflake.Connection | null = null;
let connectionPromise: Promise<snowflake.Connection> | null = null;

async function getConnection(): Promise<snowflake.Connection> {
  if (connection) return connection;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    const connConfig: snowflake.ConnectionOptions = {
      account: process.env.SNOWFLAKE_ACCOUNT || "<account>",
      username: process.env.SNOWFLAKE_USER || "<username>",
      authenticator: "EXTERNALBROWSER",
      warehouse: process.env.SNOWFLAKE_WAREHOUSE || "<warehouse>",
      database: process.env.SNOWFLAKE_DATABASE || "<database>",
      schema: process.env.SNOWFLAKE_SCHEMA || "<schema>",
    };

    const conn = snowflake.createConnection(connConfig);
    await conn.connectAsync(() => {});
    connection = conn;
    return connection;
  })();

  return connectionPromise;
}

// ============ REMOTE (SPCS): Connection Pool ============
let pool: snowflake.Pool<snowflake.Connection> | null = null;

function getPool(): snowflake.Pool<snowflake.Connection> {
  if (pool) return pool;

  const token = fs.readFileSync("/snowflake/session/token", "utf8");
  const host = process.env.SNOWFLAKE_HOST || "";

  const connConfig: snowflake.ConnectionOptions = {
    accessUrl: `https://${host}`,
    account: host.split(".")[0] || "snowflake",
    authenticator: "OAUTH",
    token: token,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "<warehouse>",
    database: process.env.SNOWFLAKE_DATABASE || "<database>",
    schema: process.env.SNOWFLAKE_SCHEMA || "<schema>",
  };

  pool = snowflake.createPool(connConfig, {
    max: 10,
    min: 1,
    evictionRunIntervalMillis: 60000,
    idleTimeoutMillis: 300000,
  });

  return pool;
}

// ============ Unified Query Function ============
export async function querySnowflake<T>(sql: string): Promise<T[]> {
  if (isRunningInSPCS()) {
    const connectionPool = getPool();
    return new Promise((resolve, reject) => {
      connectionPool
        .use(async (clientConnection) => {
          return new Promise<T[]>((res, rej) => {
            clientConnection.execute({
              sqlText: sql,
              complete: (err, stmt, rows) => {
                if (err) {
                  console.error("Query error:", err.message);
                  rej(err);
                } else {
                  res((rows || []) as T[]);
                }
              },
            });
          });
        })
        .then(resolve)
        .catch(reject);
    });
  } else {
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
}
```

### Create API Routes

**All API routes MUST query real Snowflake data using `querySnowflake`:**

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

### shadcn Chart Usage Pattern

**Always use shadcn chart components with CSS variables for colors:**

```typescript
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp } from "lucide-react"

const chartConfig = {
  revenue: { label: "Revenue", color: "hsl(var(--chart-1))" },
  orders: { label: "Orders", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig

// Use var(--color-<key>) in chart fills/strokes
<Bar dataKey="revenue" fill="var(--color-revenue)" />

// Always include CardFooter with trend indicator
<CardFooter className="flex-col gap-2 text-sm">
  <div className="flex items-center gap-2 font-medium leading-none">
    Trending up by 5.2% <TrendingUp className="h-4 w-4" />
  </div>
</CardFooter>
```

**Available chart colors:** `--chart-1` through `--chart-5` (defined in globals.css)

---

## Step 6: Test Locally (REQUIRED)

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

## Step 7: SPCS Prerequisites

### Check Current Role

```sql
SELECT CURRENT_ROLE(), CURRENT_USER();
```

### Check/Create Compute Pool

```sql
SHOW COMPUTE POOLS;

-- If no accessible pool exists:
CREATE COMPUTE POOL <pool_name>
  MIN_NODES = 1
  MAX_NODES = 1
  INSTANCE_FAMILY = CPU_X64_XS;
```

**Note:** You can only use compute pools owned by your current role or where you have USAGE privilege.

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

## Step 8: Create Dockerfile

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

## Step 9: Create Service Specification

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

## Step 10: Build and Push Docker Image

```bash
docker build --platform linux/amd64 -t <image-name>:latest .
docker tag <image-name>:latest <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
docker push <registry-url>/<db>/<schema>/<repo>/<image-name>:latest
```

---

## Step 11: Deploy to SPCS

```sql
CREATE SERVICE <service_name>
  IN COMPUTE POOL <pool_name>
  FROM SPECIFICATION $$
  <contents of service-spec.yaml>
  $$;
```

### Monitor, Get URL, and Verify

```sql
SELECT SYSTEM$GET_SERVICE_STATUS('<service_name>');
SHOW ENDPOINTS IN SERVICE <service_name>;
```

**IMPORTANT:** Extract the `ingress_url` from SHOW ENDPOINTS and **display it to the user**.

Verify the deployed app:
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
