"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { DollarSign, Users, ShoppingCart, TrendingUp } from "lucide-react";

interface RevenueData {
  REGION: string;
  REVENUE: number;
  [key: string]: string | number;
}

interface CustomerData {
  C_MKTSEGMENT: string;
  CUSTOMER_COUNT: number;
  AVG_BALANCE: number;
  [key: string]: string | number;
}

interface OrderData {
  YEAR: number;
  MONTH: number;
  ORDER_COUNT: number;
  TOTAL_PRICE: number;
  [key: string]: string | number;
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8"];

export default function Home() {
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [customerData, setCustomerData] = useState<CustomerData[]>([]);
  const [orderData, setOrderData] = useState<OrderData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [revRes, custRes, ordRes] = await Promise.all([
          fetch("/api/revenue"),
          fetch("/api/customers"),
          fetch("/api/orders"),
        ]);
        const [rev, cust, ord] = await Promise.all([
          revRes.json(),
          custRes.json(),
          ordRes.json(),
        ]);
        setRevenueData(rev);
        setCustomerData(cust);
        setOrderData(ord);
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const totalRevenue = revenueData.reduce((sum, r) => sum + r.REVENUE, 0);
  const totalCustomers = customerData.reduce((sum, c) => sum + c.CUSTOMER_COUNT, 0);
  const totalOrders = orderData.reduce((sum, o) => sum + o.ORDER_COUNT, 0);
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const ordersByMonth = orderData.map((o) => ({
    name: `${o.YEAR}-${String(o.MONTH).padStart(2, "0")}`,
    orders: o.ORDER_COUNT,
    revenue: o.TOTAL_PRICE / 1000000,
  }));

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100">
        <div className="text-xl font-semibold text-gray-600">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <h1 className="mb-8 text-3xl font-bold text-gray-800">TPC-H Sales Dashboard</h1>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Revenue"
          value={`$${(totalRevenue / 1e9).toFixed(2)}B`}
          icon={<DollarSign className="h-6 w-6" />}
          color="bg-blue-500"
        />
        <StatCard
          title="Total Customers"
          value={totalCustomers.toLocaleString()}
          icon={<Users className="h-6 w-6" />}
          color="bg-green-500"
        />
        <StatCard
          title="Total Orders"
          value={totalOrders.toLocaleString()}
          icon={<ShoppingCart className="h-6 w-6" />}
          color="bg-yellow-500"
        />
        <StatCard
          title="Avg Order Value"
          value={`$${avgOrderValue.toFixed(2)}`}
          icon={<TrendingUp className="h-6 w-6" />}
          color="bg-purple-500"
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-700">Revenue by Region</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={revenueData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="REGION" tick={{ fontSize: 12 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1e9).toFixed(1)}B`} />
              <Tooltip formatter={(v) => `$${(Number(v) / 1e9).toFixed(2)}B`} />
              <Bar dataKey="REVENUE" fill="#0088FE" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-700">Customers by Segment</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={customerData}
                dataKey="CUSTOMER_COUNT"
                nameKey="C_MKTSEGMENT"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name }) => name}
              >
                {customerData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <h2 className="mb-4 text-lg font-semibold text-gray-700">Orders Over Time</h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={ordersByMonth.slice(-24)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="left" tickFormatter={(v) => `${v / 1000}K`} />
            <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `$${v}M`} />
            <Tooltip />
            <Line yAxisId="left" type="monotone" dataKey="orders" stroke="#0088FE" name="Orders" />
            <Line yAxisId="right" type="monotone" dataKey="revenue" stroke="#00C49F" name="Revenue ($M)" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-800">{value}</p>
        </div>
        <div className={`rounded-full p-3 text-white ${color}`}>{icon}</div>
      </div>
    </div>
  );
}
