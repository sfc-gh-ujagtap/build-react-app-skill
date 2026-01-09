import { NextResponse } from "next/server";
import { querySnowflake } from "@/lib/snowflake";

interface CustomerBySegment {
  C_MKTSEGMENT: string;
  CUSTOMER_COUNT: number;
  AVG_BALANCE: number;
}

export async function GET() {
  try {
    const results = await querySnowflake<CustomerBySegment>(`
      SELECT 
        C_MKTSEGMENT,
        COUNT(*) AS CUSTOMER_COUNT,
        AVG(C_ACCTBAL) AS AVG_BALANCE
      FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.CUSTOMER
      GROUP BY C_MKTSEGMENT
      ORDER BY CUSTOMER_COUNT DESC
    `);
    return NextResponse.json(results);
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
  }
}
