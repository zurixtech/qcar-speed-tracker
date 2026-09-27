import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QCar Radar · Detector de velocidad",
  description:
    "App de celular: detectá hasta dos vehículos con la cámara y mostrá su velocidad en el recuadro.",
  applicationName: "QCar Radar",
  // Para "agregar a la pantalla de inicio": se abre sin barra del navegador.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "QCar Radar" },
};

export const viewport: Viewport = {
  themeColor: "#060a14",
  width: "device-width",
  initialScale: 1,
  // Se permite pinch-zoom (WCAG 1.4.4): sin rebote de scroll de pagina, pero
  // sin bloquear el zoom para quien lo necesita para leer.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
