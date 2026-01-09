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
        database: process.env.SNOWFLAKE_DATABASE || "SNOWFLAKE_SAMPLE_DATA",
        schema: process.env.SNOWFLAKE_SCHEMA || "TPCH_SF1",
      };
    } else {
      connConfig = {
        account: process.env.SNOWFLAKE_ACCOUNT || "pm",
        username: process.env.SNOWFLAKE_USER || "ujagtap",
        authenticator: "EXTERNALBROWSER",
        warehouse: process.env.SNOWFLAKE_WAREHOUSE || "COMPUTE_WH",
        database: process.env.SNOWFLAKE_DATABASE || "SNOWFLAKE_SAMPLE_DATA",
        schema: process.env.SNOWFLAKE_SCHEMA || "TPCH_SF1",
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
