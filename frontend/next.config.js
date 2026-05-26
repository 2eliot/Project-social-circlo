/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { typedRoutes: false },
  skipTrailingSlashRedirect: true,
  webpack(config, { dev }) {
    if (dev) {
      config.cache = false;
    }

    return config;
  },
  async rewrites() {
    const backend = process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:4000';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backend}/api/v1/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backend}/uploads/:path*`,
      },
      {
        source: '/socket.io/',
        destination: `${backend}/socket.io/`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${backend}/socket.io/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
