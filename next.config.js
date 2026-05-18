const config = {
  reactStrictMode: true,
  async rewrites() {
    // 生产环境通过 NEXT_PUBLIC_API_URL 直接调用 Railway 后端
    if (process.env.NODE_ENV === "production") return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

module.exports = config;