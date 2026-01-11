---
name: build-react-app-skill
description: Build and deploy data-intensive React/Next.js applications to Snowflake. Creates distinctive, production-grade interfaces with real-time Snowflake data.
---

# Build Data-Intensive Apps for Snowflake

## Overview
This skill guides you through building data-intensive Next.js applications and deploying them to Snowflake using Snowpark Container Services (SPCS). Create dashboards, analytics tools, admin panels, customer-facing data products, and more.

---

## Step 1: Understand Requirements

Before writing any code, clarify with the user:
- What data should the app use? (Search for tables/views using `snowflake_object_search`)
- What type of application? (Dashboard, admin panel, customer-facing tool, data explorer)
- Any specific aesthetic direction? (Minimal, bold, playful, enterprise, etc.)

**CRITICAL: NEVER use mock/hardcoded data. Always connect to real Snowflake tables.**

---

## Step 2: Design Principles

Before coding, commit to a clear aesthetic direction. Data apps should be functional AND visually distinctive.

### Design Thinking
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose a direction - minimal/refined, bold/maximalist, playful, editorial, industrial, soft/approachable. Match the brand and audience.
- **Differentiation**: What makes this memorable? Avoid generic "AI slop" aesthetics.

### Aesthetic Guidelines

**Typography**: Choose fonts with character. Avoid overused defaults (Inter, Roboto, Arial). Pair a distinctive display font with a refined body font. shadcn defaults are acceptable but consider customizing for brand alignment.

**Color**: Use CSS variables (`--chart-1` through `--chart-5`) for data visualization - never hardcode colors. For UI, commit to a cohesive palette. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Support dark mode.

**Motion**: Add purposeful animations for delight. Focus on high-impact moments: page load reveals, hover states, transitions between data states. Use CSS transitions or Framer Motion. One well-orchestrated animation creates more impact than scattered micro-interactions.

**Layout**: Be intentional about density. Data-heavy apps can embrace density with clear hierarchy. Generous whitespace works for focused tools. Use consistent spacing tokens (`space-y-6`, `gap-4`/`gap-6`).

**Visual Details**: Create atmosphere beyond flat backgrounds. Consider subtle gradients, grain textures, shadows for depth, or geometric patterns that match the aesthetic.

### What to Avoid
- Generic purple gradients on white backgrounds
- Cookie-cutter layouts without context-specific character
- Inconsistent spacing and sizing
- Raw HTML elements when shadcn components exist
- Hardcoded colors instead of CSS variables

---

## Step 3: Tech Stack (Required)

### Prerequisites
```bash
node --version  # Must be v20.x.x or higher
docker --version
```

### Create Next.js Project
```bash
npx create-next-app@latest <app-name> --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"
cd <app-name>
```

### Initialize shadcn/ui (REQUIRED)
```bash
npx shadcn@latest init -d
```

This creates:
- `components/ui/` directory for shadcn components
- `lib/utils.ts` with the `cn()` helper
- CSS variables in `globals.css`

### Add shadcn Components
```bash
npx shadcn@latest add card chart button table select input tabs badge skeleton dialog dropdown-menu separator tooltip sidebar
```

### Install Dependencies
```bash
npm install recharts@2.15.4 lucide-react snowflake-sdk
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

### Snowflake Connection (lib/snowflake.ts)

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
│   ├── snowflake.ts
│   └── utils.ts
├── Dockerfile
├── service-spec.yaml
└── next.config.ts
```

### API Routes

All API routes MUST query real Snowflake data:

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

### Component Guidelines

**Use shadcn/ui components** - Never raw HTML tables, inputs, or buttons:
- `Card` for content containers
- `Table` for data tables
- `Badge` for status indicators
- `Skeleton` for loading states
- `ChartContainer` for all charts

**Charts**: Use shadcn's `ChartContainer` wrapper with Recharts. Define `ChartConfig` with `hsl(var(--chart-X))` colors, reference as `var(--color-<key>)` in fills/strokes.

**Icons**: Use Lucide React consistently.

**State Management**: 
- Global filters (date ranges, etc.) via React Context
- Loading states with Skeleton components matching layout structure
- API returns UPPERCASE field names from SQL

### Dashboard Pattern (Recommended for Analytics)

For analytics dashboards, this pattern works well:

1. **Stat Cards Row**: Responsive grid (`grid-cols-2 md:grid-cols-3 lg:grid-cols-6`) for KPI metrics
2. **Chart Grid**: 2-column on large screens (`grid-cols-1 lg:grid-cols-2`)
3. **Consistent Chart Heights**: Use uniform heights within rows for visual balance
4. **Card Structure**: Header (title + description) → Content (visualization) → Footer (insight/trend)

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
  instructions="Verify app loads with REAL Snowflake data and UI is polished."
)
```

### Build Test
```bash
npm run build
```

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

**IMPORTANT:** Extract the `ingress_url` from SHOW ENDPOINTS and display it to the user.

Verify the deployed app:
```
ai_browser(
  initial_url="https://<ingress_url>",
  instructions="Verify app loads with real Snowflake data."
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
