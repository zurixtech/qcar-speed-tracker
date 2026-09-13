import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // El modelo de TF.js se descarga desde el CDN de Google en tiempo de ejecucion.
  // Permitimos el acceso a la camara solo desde el mismo origen.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
