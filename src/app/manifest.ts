import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UltimateCapital",
    short_name: "UltimateCapital",
    description: "The operating system for an AI-run wholesaling business.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f7f5",
    theme_color: "#0f5d43",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Approvals", url: "/approvals", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Deals", url: "/deals", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Recommendations", url: "/recommendations", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
