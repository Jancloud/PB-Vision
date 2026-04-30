"use client";

import { useEffect } from "react";

export default function PwaBootstrap() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js")
          .catch((error) => {
            if (process.env.NODE_ENV !== "production") {
              // eslint-disable-next-line no-console
              console.error("[PWA Service]: Service Worker registration failed", error);
            }
          });
      });
    }

    const onBeforeInstallPrompt = () => {
      // eslint-disable-next-line no-console
      console.info("[PWA Service]: Ready to install on home screen.");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  return null;
}

