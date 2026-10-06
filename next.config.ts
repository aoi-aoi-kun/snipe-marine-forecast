import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server listens on all interfaces; the browser uses 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
