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

The app detects its environment by checking for the SPCS token file at `/snowflake/session/token`:
- **Token exists** → Running in SPCS → Use OAuth authentication
- **No token** → Local development → Use External Browser (SSO)

Both environments use a single cached connection with retry logic for simplicity.

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

This simplified pattern uses a single cached connection with retry logic for both local and SPCS environments:

```typescript
import snowflake from "snowflake-sdk";
import fs from "fs";

snowflake.configure({ logLevel: "ERROR" });

let connection: snowflake.Connection | null = null;
let cachedToken: string | null = null;

function getOAuthToken(): string | null {
  const tokenPath = "/snowflake/session/token";
  try {
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, "utf8");
    }
  } catch {
    // Not in SPCS environment
  }
  return null;
}

function getConfig(): snowflake.ConnectionOptions {
  const base = {
    account: process.env.SNOWFLAKE_ACCOUNT || "<account>",
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "<warehouse>",
    database: process.env.SNOWFLAKE_DATABASE || "<database>",
    schema: process.env.SNOWFLAKE_SCHEMA || "<schema>",
  };

  const token = getOAuthToken();
  if (token) {
    return {
      ...base,
      host: process.env.SNOWFLAKE_HOST,
      token,
      authenticator: "oauth",
    };
  }

  return {
    ...base,
    username: process.env.SNOWFLAKE_USER || "<username>",
    authenticator: "EXTERNALBROWSER",
  };
}

async function getConnection(): Promise<snowflake.Connection> {
  const token = getOAuthToken();

  if (connection && (!token || token === cachedToken)) {
    return connection;
  }

  if (connection) {
    console.log("OAuth token changed, reconnecting");
    connection.destroy(() => {});
  }

  console.log(token ? "Connecting with OAuth token" : "Connecting with external browser");
  const conn = snowflake.createConnection(getConfig());
  await conn.connectAsync(() => {});
  connection = conn;
  cachedToken = token;
  return connection;
}

function isRetryableError(err: unknown): boolean {
  const error = err as { message?: string; code?: number };
  return !!(
    error.message?.includes("OAuth access token expired") ||
    error.message?.includes("terminated connection") ||
    error.code === 407002
  );
}

export async function query<T>(sql: string, retries = 1): Promise<T[]> {
  try {
    const conn = await getConnection();
    return await new Promise<T[]>((resolve, reject) => {
      conn.execute({
        sqlText: sql,
        complete: (err, stmt, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve((rows || []) as T[]);
          }
        },
      });
    });
  } catch (err) {
    console.error("Query error:", (err as Error).message);
    if (retries > 0 && isRetryableError(err)) {
      connection = null;
      return query(sql, retries - 1);
    }
    throw err;
  }
}
```

**Key features:**
- Single connection for both environments (no pool complexity)
- Auto-detects SPCS via token file presence
- Handles OAuth token refresh by comparing cached vs current token
- Retry logic handles session timeouts and expired tokens

### Create API Routes

**All API routes MUST query real Snowflake data using `query`:**

```typescript
// app/api/data/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/snowflake";

export async function GET() {
  try {
    const results = await query<{ COL1: string; COL2: number }>(`
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

### Dashboard Design System

When building dashboards or analytics apps, follow these principles for consistent, professional results:

1. **Color**: Use CSS variables (`--chart-1` to `--chart-5`) for all chart/accent colors - never hardcode. Reference as `hsl(var(--chart-X))` in ChartConfig, `text-chart-X` in Tailwind classes.

2. **Components**: Use shadcn/ui for all primitives (Card, Table, Badge, Skeleton) - never raw HTML tables or custom badges. Use Recharts wrapped in `ChartContainer`. Use Lucide for icons.

3. **Layout**: Use 6-column responsive stat grid (`grid-cols-2 md:grid-cols-3 lg:grid-cols-6`), 2-column chart grid (`grid-cols-1 lg:grid-cols-2`). Consistent spacing with `space-y-6` for sections, `gap-4`/`gap-6` for grids.

4. **Chart Cards**: Fixed `h-[300px] w-full` for all `ChartContainer` elements. Structure as Header (CardTitle + CardDescription) → Content (chart) → Footer (insight with TrendingUp icon). Define `ChartConfig` with `{ label, color: "hsl(var(--chart-X))" }` per data series.

5. **State**: Global filters (e.g., date range) via React Context. Use Skeleton loading states that match layout structure. API routes return UPPERCASE field names from SQL queries.

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
