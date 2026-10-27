import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "./auth";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "SA Connect — Your world, connected" },
    { name: "description", content: "Connect with your people through messages, stories, reels and video on SA Connect." },
    { property: "og:title", content: "SA Connect — Your world, connected" },
    { property: "og:description", content: "Your people, moments and community in one place." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: AuthPage,
});
