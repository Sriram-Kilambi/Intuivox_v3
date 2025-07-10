"use client";

import { useState } from "react";
import { RocketIcon, ExternalLinkIcon, SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hint } from "@/components/hint";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Fragment } from "@/generated/prisma";

interface DeployButtonProps {
  fragment: Fragment;
  disabled?: boolean;
}

export const DeployButton = ({ fragment, disabled }: DeployButtonProps) => {
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [customDomain, setCustomDomain] = useState("");
  const [projectName, setProjectName] = useState("");
  const trpc = useTRPC();

  // Check Railway connection status
  const { data: railwayConnection, isLoading: isCheckingConnection } =
    trpc.deployments.getRailwayConnection.useQuery();

  // Deploy mutation
  const deployMutation = trpc.deployments.deploy.useMutation({
    onSuccess: (data) => {
      toast.success("🚀 Deployment started!", {
        description:
          "Your app is being deployed to Railway. You'll receive updates in real-time.",
        duration: 5000,
      });
      setIsDeployModalOpen(false);
      setCustomDomain("");
      setProjectName("");
    },
    onError: (error) => {
      toast.error("Deployment failed", {
        description: error.message,
        duration: 5000,
      });
    },
  });

  // Connect Railway mutation
  const connectRailwayMutation = trpc.deployments.connectRailway.useMutation({
    onSuccess: () => {
      toast.success("Railway connected!", {
        description: "You can now deploy your apps to Railway.",
        duration: 3000,
      });
    },
    onError: (error) => {
      toast.error("Connection failed", {
        description: error.message,
        duration: 5000,
      });
    },
  });

  const handleDeploy = () => {
    if (!railwayConnection?.isConnected) {
      toast.error("Railway not connected", {
        description: "Please connect your Railway account first.",
        duration: 3000,
      });
      return;
    }

    deployMutation.mutate({
      fragmentId: fragment.id,
      customDomain: customDomain || undefined,
      projectName: projectName || undefined,
    });
  };

  const handleConnectRailway = () => {
    // In a real app, this would redirect to Railway OAuth
    // For now, we'll show a simplified form
    const token = prompt("Enter your Railway API token:");
    const email = prompt("Enter your Railway account email:");

    if (token && email) {
      connectRailwayMutation.mutate({
        accessToken: token,
        email: email,
      });
    }
  };

  if (isCheckingConnection) {
    return (
      <Hint text="Loading..." side="bottom" align="start">
        <Button size="sm" variant="outline" disabled>
          <RocketIcon className="w-4 h-4 animate-spin" />
        </Button>
      </Hint>
    );
  }

  return (
    <Dialog open={isDeployModalOpen} onOpenChange={setIsDeployModalOpen}>
      <DialogTrigger asChild>
        <Hint text="Deploy to Railway" side="bottom" align="start">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || deployMutation.isPending}
            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white border-0"
          >
            <RocketIcon className="w-4 h-4" />
          </Button>
        </Hint>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RocketIcon className="w-5 h-5 text-purple-500" />
            Deploy to Railway
          </DialogTitle>
          <DialogDescription>
            Deploy your app to Railway with custom domain support and automatic
            SSL.
          </DialogDescription>
        </DialogHeader>

        {!railwayConnection?.isConnected ? (
          // Railway not connected
          <div className="space-y-4">
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 mx-auto bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center">
                <SettingsIcon className="w-8 h-8 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-medium">Connect Railway Account</h3>
                <p className="text-sm text-muted-foreground">
                  Connect your Railway account to deploy your apps with one
                  click.
                </p>
              </div>
              <Button
                onClick={handleConnectRailway}
                disabled={connectRailwayMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700"
              >
                {connectRailwayMutation.isPending
                  ? "Connecting..."
                  : "Connect Railway"}
              </Button>
            </div>
          </div>
        ) : (
          // Railway connected - show deployment form
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name (Optional)</Label>
              <Input
                id="project-name"
                placeholder={`${fragment.title || "app"}-${Date.now()}`}
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to auto-generate based on fragment title
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="custom-domain">Custom Domain (Optional)</Label>
              <Input
                id="custom-domain"
                placeholder="your-domain.com"
                value={customDomain}
                onChange={(e) => setCustomDomain(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Add your custom domain with automatic SSL certificate
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <div className="w-4 h-4 rounded-full bg-blue-500 mt-0.5 flex-shrink-0"></div>
                <div className="text-sm">
                  <p className="font-medium text-blue-900 dark:text-blue-100">
                    What happens next?
                  </p>
                  <ul className="text-blue-700 dark:text-blue-300 mt-1 space-y-1">
                    <li>• Your code will be uploaded to Railway</li>
                    <li>• Automatic Next.js build and deployment</li>
                    <li>• Live URL available in ~2-3 minutes</li>
                    <li>• Custom domain setup (if provided)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {railwayConnection?.isConnected && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeployModalOpen(false)}
              disabled={deployMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeploy}
              disabled={deployMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {deployMutation.isPending ? (
                <>
                  <RocketIcon className="w-4 h-4 mr-2 animate-spin" />
                  Deploying...
                </>
              ) : (
                <>
                  <RocketIcon className="w-4 h-4 mr-2" />
                  Deploy Now
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
