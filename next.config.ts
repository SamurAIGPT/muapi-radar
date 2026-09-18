import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pdfkit", "@modelcontextprotocol/sdk"],
  devIndicators: false,
};

export default nextConfig;
