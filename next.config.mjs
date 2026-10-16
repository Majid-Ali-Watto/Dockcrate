const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' }, // never let another site frame the editor (clickjacking)
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  // Browsers ignore it over plain http (localhost), so it only takes effect on the hosted https site.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The generator is plain Node code run by the route handlers; the web UI never reads or writes the disk (the CLI is the only writer).
  poweredByHeader: false,
  agentRules: false, // Next 16 would otherwise write an AGENTS.md into the repository on every dev start
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Shared links embed these from other sites (chat apps, search results), so they may be loaded cross-origin.
      ...['/og-image.png', '/logo.svg', '/icons/:file*'].map((source) => ({
        source,
        headers: [{ key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' }],
      })),
    ];
  },
};

export default nextConfig;
