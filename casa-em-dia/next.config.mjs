/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: process.cwd() },
  ...(process.env.CASA_STATIC_EXPORT === '1' ? {
    output: 'export',
    trailingSlash: true,
    images: { unoptimized: true },
  } : {}),
};
export default config;
