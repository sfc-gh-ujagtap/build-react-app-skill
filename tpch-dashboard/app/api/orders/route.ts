import { NextResponse } from "next/server";
import { querySnowflake } from "@/lib/snowflake";

interface OrdersByMonth {
  YEAR: number;
  MONTH: number;
  ORDER_COUNT: number;
  TOTAL_PRICE: number;
}

export async function GET() {
  try {
    const results = await querySnowflake<OrdersByMonth>(`
      SELECT 
        YEAR(O_ORDERDATE) AS YEAR,
        MONTH(O_ORDERDATE) AS MONTH,
        COUNT(*) AS ORDER_COUNT,
        SUM(O_TOTALPRICE) AS TOTAL_PRICE
      FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.ORDERS
      GROUP BY YEAR(O_ORDERDATE), MONTH(O_ORDERDATE)
      ORDER BY YEAR, MONTH
    `);
    return NextResponse.json(results);
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }
}
