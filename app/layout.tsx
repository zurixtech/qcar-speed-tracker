import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QCar Radar · Detector de velocidad",
  description:
    "App de celular: detecta hasta dos vehiculos con la camara y muestra su velocidad en el recuadro.",
  // Para "agregar a la pantalla de inicio": se abre sin barra del navegador.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "QCar Radar" },
};

export const viewport: Viewport = {
  themeColor: "#060a14",
  width: "device-width",
  initialScale: 1,
  // Sin zoom ni rebote: la pantalla es un visor de camara, no un documento.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
