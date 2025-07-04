import { Fragment } from "@/generated/prisma";
import { useState, useEffect, useCallback } from "react";
import { ExternalLinkIcon, RefreshCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/hint";
import { useTRPC } from "@/trpc/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

interface Props {
  data: Fragment;
  projectId: string;
}

export const FragmentWeb = ({ data, projectId }: Props) => {
  const [fragmentKey, setFragmentKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [sandboxStatus, setSandboxStatus] = useState<
    "loading" | "active" | "expired"
  >("expired");
  const [currentSandboxUrl, setCurrentSandboxUrl] = useState(data.sandboxUrl);
  const [lastRegenerationTime, setLastRegenerationTime] = useState(0);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Update current sandbox URL when data changes
  useEffect(() => {
    setCurrentSandboxUrl(data.sandboxUrl);
  }, [data.sandboxUrl]);

  const regenerateSandbox = useMutation(
    trpc.messages.regenerateSandbox.mutationOptions({
      onSuccess: async (result) => {
        // Dismiss any existing toasts to prevent stacking
        toast.dismiss();

        // Show single success toast
        toast.success("✨ Fresh environment ready!", {
          description:
            "Your sandbox has been regenerated with all files restored",
          duration: 3000,
        });

        // Immediately set to loading to hide iframe and show loading screen
        setSandboxStatus("loading");

        // Small delay to ensure loading screen is visible before changing URL
        setTimeout(() => {
          // Update the current sandbox URL with the new one
          if (result.newSandboxUrl) {
            setCurrentSandboxUrl(result.newSandboxUrl);
          }

          // Increment fragment key to force iframe reload with new URL
          setFragmentKey((prev) => prev + 1);
        }, 100); // Short delay to ensure smooth transition

        // Also invalidate queries to update the parent data
        queryClient.invalidateQueries({
          queryKey: trpc.messages.getMany.queryKey({
            projectId,
          }),
        });
      },
      onError: (error) => {
        // Dismiss any existing toasts to prevent stacking
        toast.dismiss();

        toast.error("Failed to create new environment", {
          description: error.message,
          duration: 5000,
        });
        setSandboxStatus("expired"); // Reset status on error
      },
    })
  );

  const handleRegenerateSandbox = useCallback(() => {
    const now = Date.now();
    const timeSinceLastRegeneration = now - lastRegenerationTime;

    // Prevent multiple regenerations within 5 seconds
    if (timeSinceLastRegeneration < 5000) {
      console.log("Regeneration request ignored - too soon after last attempt");
      return;
    }

    console.log("Starting sandbox regeneration...");
    setLastRegenerationTime(now);

    regenerateSandbox.mutate({
      projectId,
      fragmentId: data.id,
    });
  }, [regenerateSandbox.mutate, projectId, data.id, lastRegenerationTime]);

  // Auto-regenerate sandbox when URL changes and looks expired
  useEffect(() => {
    if (currentSandboxUrl) {
      console.log(
        "Sandbox URL changed, checking if auto-regeneration needed:",
        currentSandboxUrl
      );

      // Check if this URL came from a recent regeneration by comparing with data.sandboxUrl
      const isOriginalUrl = currentSandboxUrl === data.sandboxUrl;
      const isE2BUrl =
        currentSandboxUrl.includes("e2b.dev") ||
        currentSandboxUrl.includes("e2b.run") ||
        currentSandboxUrl.includes("e2b.app");

      // Only auto-regenerate if:
      // 1. It's the original E2B URL from data (not a freshly regenerated one)
      // 2. No regeneration is currently in progress
      // 3. Sandbox status is not already loading
      if (
        isE2BUrl &&
        isOriginalUrl &&
        !regenerateSandbox.isPending &&
        sandboxStatus !== "loading"
      ) {
        const now = Date.now();
        const timeSinceLastRegeneration = now - lastRegenerationTime;

        // Only auto-regenerate if enough time has passed
        if (timeSinceLastRegeneration >= 5000) {
          console.log("Original E2B URL detected, auto-regenerating sandbox");
          setSandboxStatus("loading");
          handleRegenerateSandbox();
        } else {
          console.log(
            "Auto-regeneration skipped - too soon after last attempt"
          );
        }
      } else if (isE2BUrl && !isOriginalUrl) {
        // This is a freshly regenerated E2B URL, set to loading and let iframe onLoad handle the rest
        console.log("Fresh E2B URL detected, setting to loading");
        setSandboxStatus("loading");

        // Fallback timeout in case iframe onLoad doesn't fire
        const fallbackTimeout = setTimeout(() => {
          setSandboxStatus((prev) => {
            if (prev === "loading") {
              console.log(
                "Fallback timeout: iframe didn't load, setting to active anyway"
              );
              return "active";
            }
            return prev;
          });
        }, 10000); // 10 second fallback

        return () => clearTimeout(fallbackTimeout);
      } else if (!isE2BUrl) {
        // Non-E2B URL should work immediately
        setSandboxStatus("active");
      }
    }
  }, [
    currentSandboxUrl,
    regenerateSandbox.isPending,
    handleRegenerateSandbox,
    data.sandboxUrl,
    lastRegenerationTime,
  ]);

  const onRefresh = () => {
    setFragmentKey((prev) => prev + 1);
    setSandboxStatus("loading");

    // Set timeout to mark as expired if iframe doesn't load within 10 seconds
    setTimeout(() => {
      setSandboxStatus((prev) => (prev === "loading" ? "expired" : prev));
    }, 10000);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentSandboxUrl);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="flex flex-col w-full h-full">
      <div className="p-2 border-b bg-sidebar flex items-center gap-x-2">
        <Hint text="Refresh" side="bottom" align="start">
          <Button size="sm" variant="outline" onClick={onRefresh}>
            <RefreshCcwIcon />
          </Button>
        </Hint>

        <Hint text="Copy URL" side="bottom" align="start">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            className="flex-1 justify-start text-start font-normal"
            disabled={!currentSandboxUrl || copied}
          >
            <span className="truncate">{currentSandboxUrl}</span>
          </Button>
        </Hint>
        <Hint text="Open in a new tab" side="bottom" align="start">
          <Button
            size="sm"
            disabled={!currentSandboxUrl || sandboxStatus === "loading"}
            variant="outline"
            onClick={() => {
              if (!currentSandboxUrl) return;
              window.open(currentSandboxUrl, "_blank");
            }}
          >
            <ExternalLinkIcon />
          </Button>
        </Hint>
      </div>

      <div className="flex-1 relative bg-slate-100 dark:bg-slate-900">
        {/* Only show iframe when not loading to prevent flashing old content */}
        <iframe
          key={fragmentKey}
          className={`h-full w-full transition-opacity duration-300 ${
            sandboxStatus === "loading"
              ? "opacity-0 pointer-events-none"
              : "opacity-100"
          }`}
          sandbox="allow-forms allow-scripts allow-same-origin"
          loading="lazy"
          src={currentSandboxUrl}
          onLoad={() => {
            console.log("=== IFRAME ONLOAD FIRED ===");
            console.log("Current URL:", currentSandboxUrl);
            console.log("Data URL:", data.sandboxUrl);
            console.log("Current status:", sandboxStatus);

            // Only set to active if it's a fresh sandbox URL (not the original expired one)
            const isOriginalUrl = currentSandboxUrl === data.sandboxUrl;
            const isE2BUrl =
              currentSandboxUrl.includes("e2b.dev") ||
              currentSandboxUrl.includes("e2b.run") ||
              currentSandboxUrl.includes("e2b.app");

            if (!isE2BUrl) {
              console.log("Non-E2B URL loaded, setting to active");
              setSandboxStatus("active");
            } else if (isE2BUrl && !isOriginalUrl) {
              console.log(
                "Fresh E2B sandbox loaded successfully, setting to active"
              );
              setSandboxStatus("active");
            } else {
              console.log(
                "Original E2B URL loaded (likely error page), will auto-regenerate"
              );
            }
          }}
          onError={() => {
            console.log("Iframe failed to load");
            setSandboxStatus("expired");
          }}
        />

        {/* Professional loading overlay */}
        {sandboxStatus === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 z-10">
            <div className="text-center p-12 max-w-md mx-auto">
              {/* Loading animation */}
              <div className="relative mb-6">
                <div className="w-16 h-16 mx-auto">
                  <div className="w-16 h-16 border-4 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin"></div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 bg-blue-600 dark:bg-blue-400 rounded-full opacity-20"></div>
                </div>
              </div>

              {/* Status message */}
              <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-3">
                {regenerateSandbox.isPending
                  ? "Setting Up Fresh Environment"
                  : "Loading Your Project"}
              </h3>

              <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed mb-4">
                {regenerateSandbox.isPending
                  ? "We're creating a new sandbox and restoring your files. This usually takes 10-15 seconds."
                  : "Preparing your development environment..."}
              </p>

              {/* Progress indicator */}
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 mb-4">
                <div
                  className="bg-blue-600 dark:bg-blue-400 h-1.5 rounded-full animate-pulse"
                  style={{ width: regenerateSandbox.isPending ? "75%" : "45%" }}
                ></div>
              </div>

              {/* Subtle hint */}
              <p className="text-xs text-slate-500 dark:text-slate-500">
                ✨ Your code will be ready in just a moment
              </p>
            </div>
          </div>
        )}

        {/* Professional expired state overlay */}
        {sandboxStatus === "expired" && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-950 dark:to-orange-900 z-10">
            <div className="text-center p-12 max-w-md mx-auto">
              {/* Warning icon */}
              <div className="w-16 h-16 mx-auto mb-6 bg-amber-100 dark:bg-amber-900 rounded-full flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-amber-600 dark:text-amber-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>

              {/* Status message */}
              <h3 className="text-xl font-semibold text-amber-800 dark:text-amber-200 mb-3">
                Sandbox Session Expired
              </h3>

              <p className="text-amber-700 dark:text-amber-300 text-sm leading-relaxed mb-6">
                Your development environment has expired after 30 minutes of
                inactivity. Don't worry - your code is safe and will be restored
                automatically.
              </p>

              <Button
                onClick={() => {
                  console.log("Manual regeneration triggered");
                  handleRegenerateSandbox();
                }}
                disabled={regenerateSandbox.isPending}
                className="bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600"
              >
                {regenerateSandbox.isPending
                  ? "Creating New Environment..."
                  : "🔄 Create Fresh Environment"}
              </Button>

              <p className="text-xs text-amber-600 dark:text-amber-400 mt-4">
                This will recreate your sandbox with all your files
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
