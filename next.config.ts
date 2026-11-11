import type { NextConfig } from "next";

/**
 * PREVIEW_MODE lets the DEV server be viewed through a preview proxy or pane (demo data only).
 * It is ignored in production builds, so it cannot weaken a deployed instance.
 */
const preview = process.env.PREVIEW_MODE === "true" && process.env.NODE_ENV !== "production";
// "**" alone is not accepted by Next, so list top-level domains a preview host may use.
const previewHosts = ["com", "ai", "app", "dev", "io", "net", "org", "run", "cloud", "sh", "site"].map((tld) => `**.${tld}`);

const securityHeaders = [
  ...(preview ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  ...(preview ? { allowedDevOrigins: previewHosts } : {}),
  experimental: {
    // CSV uploads go through a server action; the importer enforces its own 5 MB cap.
    serverActions: { bodySizeLimit: "6mb", ...(preview ? { allowedOrigins: previewHosts } : {}) },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
