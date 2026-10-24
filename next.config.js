/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emits .next/standalone with a minimal server.js for the Cloud Run image.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Firestore uses gRPC + protobufjs; keep it out of the server bundle.
  serverExternalPackages: ['@google-cloud/firestore'],
  // Proto descriptors are read from disk at runtime; make sure the standalone
  // trace copies them into the image.
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/@google-cloud/firestore/build/protos/**',
      './node_modules/google-gax/build/protos/**',
    ],
  },
};

module.exports = nextConfig;
