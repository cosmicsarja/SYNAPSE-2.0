import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      // viewport-fit=cover for iPhone notch / safe-area insets
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "FormLens" },
      { name: "description", content: "Offline-first PWA for scanning Kannada and English government forms with on-device AI." },
      // PWA / install meta
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "FormLens" },
      { name: "theme-color", content: "#1e3a5f" },
      { name: "msapplication-TileColor", content: "#1e3a5f" },
      // Open Graph
      { property: "og:title", content: "FormLens" },
      { property: "og:description", content: "Offline form scanner for Kannada and English government forms." },
      { property: "og:type", content: "website" },
      { property: "og:image", content: "/icons/icon-512.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/icons/icon-192.png", type: "image/png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      // Apple touch icon MUST be a raster PNG at 180×180 for iOS to pick it up
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/** "New version available" toast shown when SW finds an update */
function UpdateToast({ onUpdate }: { onUpdate: () => void }) {
  return (
    <div
      role="alert"
      className="fixed bottom-20 left-4 right-4 z-50 rounded-xl border border-primary/30 bg-primary text-primary-foreground shadow-lg p-3 flex items-center justify-between gap-3"
    >
      <span className="text-sm">New version available — tap to update</span>
      <button onClick={onUpdate} className="shrink-0 text-sm font-semibold underline">
        Update
      </button>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const [showUpdateToast, setShowUpdateToast] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // Don't register inside Lovable preview iframes — the cross-origin SW registration fails
    if (window.parent !== window) return;

    // Register service worker
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        setRegistration(reg);
        // Listen for a waiting worker (new version installed)
        const checkWaiting = () => {
          if (reg.waiting) setShowUpdateToast(true);
        };
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setShowUpdateToast(true);
            }
          });
        });
        // Handle the case where a waiting worker already exists on load
        checkWaiting();
      })
      .catch(() => {
        /* SW unavailable — dev mode or browser restriction */
      });

    // When a new SW takes over, reload once
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    // Trigger background sync queue when coming online
    window.addEventListener("online", () => {
      import("../lib/formlens/syncQueue").then(({ triggerSync }) => triggerSync());
    });
  }, []);

  const handleUpdate = () => {
    // Tell the waiting SW to skip waiting and become active
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    setShowUpdateToast(false);
    // controllerchange listener above will reload
  };

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      {showUpdateToast && <UpdateToast onUpdate={handleUpdate} />}
    </QueryClientProvider>
  );
}
