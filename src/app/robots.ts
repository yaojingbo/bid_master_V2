export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://bid-master-v2.vercel.app/sitemap.xml",
  };
}
