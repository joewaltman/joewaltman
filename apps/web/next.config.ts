import type { NextConfig } from "next";

// Same policy the static site served before the move to Next.js.
const csp = [
  "default-src 'self'",
  "img-src 'self' data: https: *",
  "style-src 'self' 'unsafe-inline' https: *",
  "script-src 'self' 'unsafe-inline' https: *",
  "font-src 'self' data: https: *",
  "connect-src 'self' https: *",
  "media-src 'self' https: *",
  "object-src 'none'",
  "frame-src 'self' https: *",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Content-Security-Policy", value: csp }]
    : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ["@jw/content", "@jw/db", "@jw/email"],
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
