import type { NextConfig } from "next";

// CSP para una app de una sola pagina, sin backend propio:
//  - 'unsafe-inline' en script/style porque Next inyecta scripts y estilos
//    inline (hydration data, critical CSS) que no podemos hashear a mano.
//  - 'unsafe-eval' en script-src porque el backend WebGL de TF.js compila
//    shaders y arma kernels con Function()/eval en tiempo de ejecucion; sin
//    esto la deteccion no arranca en produccion (probado a mano).
//  - connect-src permite el CDN de Google porque lib/detector.ts cae ahi
//    cuando el modelo local no esta (ver scripts/fetch-model.mjs); si algun
//    dia el modelo local es obligatorio, se puede sacar esta linea.
//  - blob:/data: en img/media/worker-src porque la captura de camara, los
//    snapshots de infracciones y los workers de TF.js pasan por ahi.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self' https://storage.googleapis.com",
  "worker-src 'self' blob:",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No delatar que corremos Next en las respuestas.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Solo la camara, y solo para el propio origen: es una app de radar.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), gyroscope=(), magnetometer=()" },
        ],
      },
      {
        // Los pesos del modelo son estaticos y versionados por carpeta
        // (public/models/coco-ssd/<variant>/...), asi que se pueden cachear
        // para siempre: evita 6 pedidos condicionales en cada visita.
        source: "/models/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
