import type { MetadataRoute } from "next";

/** Lets Erik and G add the app to a phone home screen. Contains no household data. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Finance",
    short_name: "Finance",
    description: "Private household ledger",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1218",
    theme_color: "#0f1218",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
