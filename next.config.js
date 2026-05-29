/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    const backend = (process.env.BACKEND_URL || (process.env.NODE_ENV === "production"
      ? "https://bidmasterv2-production.up.railway.app"
      : "http://localhost:8000")).replace(/\/$/, "");
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

module.exports = config;