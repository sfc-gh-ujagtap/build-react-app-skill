import { NextResponse } from "next/server";
import { querySnowflake } from "@/lib/snowflake";

interface RevenueByRegion {
  REGION: string;
  REVENUE: number;
}

export async function GET() {
  try {
    const results = await querySnowflake<RevenueByRegion>(`
      SELECT 
        R.R_NAME AS REGION,
        SUM(L.L_EXTENDEDPRICE * (1 - L.L_DISCOUNT)) AS REVENUE
      FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.LINEITEM L
      JOIN SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.ORDERS O ON L.L_ORDERKEY = O.O_ORDERKEY
      JOIN SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.CUSTOMER C ON O.O_CUSTKEY = C.C_CUSTKEY
      JOIN SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.NATION N ON C.C_NATIONKEY = N.N_NATIONKEY
      JOIN SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.REGION R ON N.N_REGIONKEY = R.R_REGIONKEY
      GROUP BY R.R_NAME
      ORDER BY REVENUE DESC
    `);
    return NextResponse.json(results);
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Failed to fetch revenue" }, { status: 500 });
  }
}
