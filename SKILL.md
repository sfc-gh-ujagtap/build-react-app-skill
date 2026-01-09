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

## Step 2: Check Node.js Version (REQUIRED)

Next.js 16+ requires Node.js >= 20.9.0. Check and upgrade if needed:

```bash
node --version
```

**If Node < 20.9.0, install Node 20:**

**macOS (Homebrew):**
```bash
brew install node@20
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
```

**Or use nvm:**
```bash
nvm install 20
nvm use 20
```

**Verify before proceeding:**
```bash
node --version  # Must show v20.x.x or higher
```

**IMPORTANT:** If Node 20 is installed via Homebrew as a keg-only formula, you must set the PATH before running npm/npx commands:
```bash
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx create-next-app@latest ...
```

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

## Step 4: Build the Application

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

Uses connection pooling to automatically handle stale connections. The pool evicts idle connections and manages reconnection transparently.

```typescript
import snowflake from "snowflake-sdk";
import fs from "fs";

snowflake.configure({ logLevel: "ERROR" });

let pool: snowflake.Pool<snowflake.Connection> | null = null;

function getOAuthToken(): string | null {
  const tokenPath = "/snowflake/session/token";
  try {
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, "utf8");
    }
  } catch (error) {
    // Not in SPCS environment
  }
  return null;
}

function getPool(): snowflake.Pool<snowflake.Connection> {
  if (pool) return pool;

  const oauthToken = getOAuthToken();

  const connConfig: snowflake.ConnectionOptions = oauthToken
    ? {
        host: process.env.SNOWFLAKE_HOST,
        account: process.env.SNOWFLAKE_ACCOUNT || "<account>",
        token: oauthToken,
        authenticator: "oauth",
        warehouse: process.env.SNOWFLAKE_WAREHOUSE || "<warehouse>",
        database: process.env.SNOWFLAKE_DATABASE || "<database>",
        schema: process.env.SNOWFLAKE_SCHEMA || "<schema>",
      }
    : {
        account: process.env.SNOWFLAKE_ACCOUNT || "<account>",
        username: process.env.SNOWFLAKE_USER || "<username>",
        authenticator: "EXTERNALBROWSER",
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

export async function querySnowflake<T>(sql: string): Promise<T[]> {
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
}
```

**Note:** On first API request locally, a browser window opens for SSO login. The connection pool automatically handles stale connections - no manual retry logic needed.

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

---

## Step 5: Test Locally (REQUIRED)

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

## Step 6: Check SPCS Prerequisites

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

## Step 7: Check Docker Prerequisite

Before building, verify Docker is installed:

```bash
docker --version 2>/dev/null || echo "DOCKER_NOT_INSTALLED"
```

### If Docker is NOT installed, install it automatically:

**macOS:**
```bash
# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "Installing Homebrew first..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

# Install Docker Desktop via Homebrew
brew install --cask docker

# Open Docker Desktop (required to start Docker daemon)
open -a Docker

echo "Waiting for Docker to start..."
while ! docker info &> /dev/null; do
    sleep 2
done
echo "Docker is ready!"
```

**Linux (Ubuntu/Debian):**
```bash
# Remove old versions
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install prerequisites
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

# Add Docker GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group (avoids sudo)
sudo usermod -aG docker $USER
echo "Log out and back in for group changes to take effect, or run: newgrp docker"
```

**Windows (PowerShell as Admin):**
```powershell
# Install via winget
winget install -e --id Docker.DockerDesktop

# Or download installer
Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" -OutFile "DockerInstaller.exe"
Start-Process -Wait -FilePath ".\DockerInstaller.exe" -ArgumentList "install", "--quiet"
Remove-Item ".\DockerInstaller.exe"

Write-Host "Please restart your computer to complete Docker installation"
```

### Verify Docker is working:
```bash
docker run --rm hello-world
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

### Monitor and Get URL

```sql
SELECT SYSTEM$GET_SERVICE_STATUS('<service_name>');
SHOW ENDPOINTS IN SERVICE <service_name>;
```

---

## Step 12: Verify Deployed Application

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
| Init shadcn | `npx shadcn@latest init -d` |
| Add components | `npx shadcn@latest add card chart button table select input tabs badge skeleton dialog dropdown-menu separator tooltip` |
| Install deps | `npm install recharts@2.15.4 lucide-react snowflake-sdk` |
| Test locally | `npm run dev` → browser opens for SSO |
| Build | `npm run build` |
| Docker build | `docker build --platform linux/amd64 -t <img>:latest .` |
| Push image | `docker push <registry>/<db>/<schema>/<repo>/<img>:latest` |
| Deploy | `CREATE SERVICE ... FROM SPECIFICATION ...` |
| Check status | `SELECT SYSTEM$GET_SERVICE_STATUS('<svc>')` |
| Get URL | `SHOW ENDPOINTS IN SERVICE <svc>` |
