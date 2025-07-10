"use client";

import { useEffect, useState } from "react";
import {
  CheckCircleIcon,
  XCircleIcon,
  RocketIcon,
  BuildingIcon,
  LoaderIcon,
  ExternalLinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";

interface DeploymentStatusProps {
  deploymentId: string;
  onClose?: () => void;
}

const STATUS_INFO = {
  CREATING: {
    label: "Creating Project",
    color: "bg-blue-500",
    icon: LoaderIcon,
    progress: 20,
    description: "Setting up your Railway project...",
  },
  BUILDING: {
    label: "Building",
    color: "bg-yellow-500",
    icon: BuildingIcon,
    progress: 50,
    description: "Building your Next.js application...",
  },
  DEPLOYING: {
    label: "Deploying",
    color: "bg-purple-500",
    icon: RocketIcon,
    progress: 80,
    description: "Deploying to Railway infrastructure...",
  },
  LIVE: {
    label: "Live",
    color: "bg-green-500",
    icon: CheckCircleIcon,
    progress: 100,
    description: "Your app is now live and accessible!",
  },
  FAILED: {
    label: "Failed",
    color: "bg-red-500",
    icon: XCircleIcon,
    progress: 0,
    description: "Deployment failed. Check the logs below.",
  },
  UPDATING: {
    label: "Updating",
    color: "bg-orange-500",
    icon: LoaderIcon,
    progress: 60,
    description: "Updating your deployment...",
  },
} as const;

export const DeploymentStatus = ({
  deploymentId,
  onClose,
}: DeploymentStatusProps) => {
  const [isPolling, setIsPolling] = useState(true);
  const trpc = useTRPC();

  // Poll deployment status
  const { data: deployment, refetch } =
    trpc.deployments.getDeploymentStatus.useQuery(
      { deploymentId },
      {
        enabled: isPolling,
        refetchInterval: isPolling ? 3000 : false, // Poll every 3 seconds while active
      }
    );

  // Stop polling when deployment is complete
  useEffect(() => {
    if (deployment?.status === "LIVE" || deployment?.status === "FAILED") {
      setIsPolling(false);

      if (deployment.status === "LIVE") {
        toast.success("🎉 Deployment successful!", {
          description: "Your app is now live and ready to use.",
          duration: 5000,
        });
      } else if (deployment.status === "FAILED") {
        toast.error("❌ Deployment failed", {
          description: "Check the deployment logs for more details.",
          duration: 5000,
        });
      }
    }
  }, [deployment?.status]);

  if (!deployment) {
    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-center space-x-2">
            <LoaderIcon className="w-4 h-4 animate-spin" />
            <span>Loading deployment status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusInfo = STATUS_INFO[deployment.status];
  const StatusIcon = statusInfo.icon;
  const isComplete =
    deployment.status === "LIVE" || deployment.status === "FAILED";

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <StatusIcon
                className={`w-5 h-5 ${
                  deployment.status === "LIVE"
                    ? "text-green-500"
                    : deployment.status === "FAILED"
                    ? "text-red-500"
                    : "text-blue-500"
                } ${!isComplete ? "animate-spin" : ""}`}
              />
              Deployment Status
            </CardTitle>
            <CardDescription>
              {deployment.projectName} • {deployment.fragment.title}
            </CardDescription>
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              ✕
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Status Badge and Progress */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Badge
              variant="secondary"
              className={`${statusInfo.color} text-white`}
            >
              {statusInfo.label}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {Math.round(statusInfo.progress)}% Complete
            </span>
          </div>

          <Progress value={statusInfo.progress} className="h-2" />

          <p className="text-sm text-muted-foreground">
            {statusInfo.description}
          </p>
        </div>

        {/* Deployment Details */}
        {deployment.deploymentUrl && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Deployment URL</h4>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted px-3 py-2 rounded text-sm truncate">
                {deployment.deploymentUrl}
              </code>
              {deployment.status === "LIVE" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.open(deployment.deploymentUrl, "_blank")
                  }
                >
                  <ExternalLinkIcon className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Custom Domain */}
        {deployment.customDomain && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Custom Domain</h4>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-muted px-3 py-2 rounded text-sm">
                https://{deployment.customDomain}
              </code>
              {deployment.status === "LIVE" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    window.open(`https://${deployment.customDomain}`, "_blank")
                  }
                >
                  <ExternalLinkIcon className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Build Logs */}
        {deployment.buildLogs && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Build Logs</h4>
            <div className="bg-black text-green-400 p-3 rounded font-mono text-xs max-h-40 overflow-auto">
              <pre className="whitespace-pre-wrap">{deployment.buildLogs}</pre>
            </div>
          </div>
        )}

        {/* Error Message */}
        {deployment.errorMessage && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-red-500">Error Details</h4>
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 p-3 rounded text-sm text-red-700 dark:text-red-300">
              {deployment.errorMessage}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          {deployment.status === "LIVE" && (
            <Button
              onClick={() => window.open(deployment.deploymentUrl, "_blank")}
              className="bg-green-600 hover:bg-green-700"
            >
              <ExternalLinkIcon className="w-4 h-4 mr-2" />
              Visit Live Site
            </Button>
          )}

          {deployment.status === "FAILED" && (
            <Button
              variant="outline"
              onClick={() => {
                setIsPolling(true);
                refetch();
              }}
            >
              Retry Deployment
            </Button>
          )}

          <Button variant="outline" onClick={() => setIsPolling(!isPolling)}>
            {isPolling ? "Stop Updates" : "Resume Updates"}
          </Button>
        </div>

        {/* Metadata */}
        <div className="text-xs text-muted-foreground pt-2 border-t">
          <div className="flex justify-between">
            <span>
              Started: {new Date(deployment.createdAt).toLocaleString()}
            </span>
            <span>
              Last Updated: {new Date(deployment.updatedAt).toLocaleString()}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
