import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Add a workspace package here (e.g. '@coachos/ui') the moment this app
  // starts importing it — Next does not transpile pnpm workspace packages
  // by default, and the failure mode is a build error naming a syntax it
  // doesn't understand, not a helpful "add this to transpilePackages".
  transpilePackages: [],
};

export default nextConfig;
