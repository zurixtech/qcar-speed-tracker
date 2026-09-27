import type { MetadataRoute } from "next";

/**
 * Manifest de "agregar a la pantalla de inicio": sin esto Android/Chrome no
 * ofrece instalar la app, y sin los iconos maskable el resultado queda con un
 * cuadrado blanco en vez del icono.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QCar Radar",
    short_name: "QCar Radar",
    description: "Radar de velocidad para celular: mide autos con la cámara, sin backend.",
    start_url: "/",
    display: "standalone",
    // Sin "orientation": la app se ve mejor en vertical, pero no le bloquea
    // la pantalla al telefono si el usuario lo gira.
    background_color: "#060a14",
    theme_color: "#060a14",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
