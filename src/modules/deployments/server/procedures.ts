import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/trpc/init";
import { deployFragmentToRailway, createRailwayAPI } from "@/lib/railway";
import { encrypt } from "@/lib/encryption";
import { TRPCError } from "@trpc/server";

export const deploymentRouter = createTRPCRouter({
  // Connect Railway account
  connectRailway: protectedProcedure
    .input(
      z.object({
        accessToken: z.string().min(1, "Access token is required"),
        email: z.string().email("Valid email is required"),
        teamId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { userId } = ctx;

      try {
        // Test the token by making a simple API call
        const railway = new (await import("@/lib/railway")).RailwayAPI(
          input.accessToken
        );
        // You can add a test query here to validate the token

        // Encrypt the access token before storing
        const encryptedToken = encrypt(input.accessToken);

        // Store or update the Railway connection
        const connection = await ctx.prisma.userRailwayConnection.upsert({
          where: { userId },
          update: {
            accessToken: encryptedToken,
            email: input.email,
            teamId: input.teamId,
            updatedAt: new Date(),
          },
          create: {
            userId,
            accessToken: encryptedToken,
            email: input.email,
            teamId: input.teamId,
          },
        });

        return {
          success: true,
          message: "Railway account connected successfully",
          connectionId: connection.id,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid Railway access token or connection failed",
        });
      }
    }),

  // Check Railway connection status
  getRailwayConnection: protectedProcedure.query(async ({ ctx }) => {
    const connection = await ctx.prisma.userRailwayConnection.findUnique({
      where: { userId: ctx.userId },
      select: {
        id: true,
        email: true,
        teamId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      isConnected: !!connection,
      connection,
    };
  }),

  // Disconnect Railway account
  disconnectRailway: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.prisma.userRailwayConnection.delete({
      where: { userId: ctx.userId },
    });

    return { success: true, message: "Railway account disconnected" };
  }),

  // Deploy fragment to Railway
  deploy: protectedProcedure
    .input(
      z.object({
        fragmentId: z.string().min(1, "Fragment ID is required"),
        customDomain: z.string().optional(),
        projectName: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { userId } = ctx;

      try {
        // Check if Railway is connected
        const railwayConnection =
          await ctx.prisma.userRailwayConnection.findUnique({
            where: { userId },
          });

        if (!railwayConnection) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Railway account not connected. Please connect your Railway account first.",
          });
        }

        // Check if fragment exists and belongs to user
        const fragment = await ctx.prisma.fragment.findUnique({
          where: { id: input.fragmentId },
          include: { project: true },
        });

        if (!fragment || fragment.project.userId !== userId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Fragment not found or access denied",
          });
        }

        // Create deployment record
        const deployment = await ctx.prisma.deployment.create({
          data: {
            fragmentId: input.fragmentId,
            userId,
            status: "CREATING",
            projectName: input.projectName || `${fragment.title}-${Date.now()}`,
            customDomain: input.customDomain,
            railwayProjectId: "", // Will be updated after creation
            railwayServiceId: "", // Will be updated after creation
            deploymentUrl: "", // Will be updated after deployment
          },
        });

        // Start deployment in background (using Inngest)
        await ctx.inngest.send({
          name: "deployment/start",
          data: {
            deploymentId: deployment.id,
            fragmentId: input.fragmentId,
            userId,
            customDomain: input.customDomain,
          },
        });

        return {
          deploymentId: deployment.id,
          status: "CREATING",
          message: "Deployment started. You'll receive updates in real-time.",
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error("Deployment error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start deployment",
        });
      }
    }),

  // Get deployment status
  getDeploymentStatus: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const deployment = await ctx.prisma.deployment.findUnique({
        where: { id: input.deploymentId },
        include: {
          fragment: {
            select: {
              title: true,
              project: {
                select: {
                  userId: true,
                },
              },
            },
          },
        },
      });

      if (!deployment || deployment.fragment.project.userId !== ctx.userId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      return deployment;
    }),

  // Get user's deployments
  getUserDeployments: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const deployments = await ctx.prisma.deployment.findMany({
        where: { userId: ctx.userId },
        include: {
          fragment: {
            select: {
              title: true,
              id: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        cursor: input.cursor ? { id: input.cursor } : undefined,
      });

      let nextCursor: string | undefined = undefined;
      if (deployments.length > input.limit) {
        const nextItem = deployments.pop();
        nextCursor = nextItem!.id;
      }

      return {
        deployments,
        nextCursor,
      };
    }),

  // Delete deployment
  deleteDeployment: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify ownership
      const deployment = await ctx.prisma.deployment.findUnique({
        where: { id: input.deploymentId },
        include: {
          fragment: {
            include: {
              project: true,
            },
          },
        },
      });

      if (!deployment || deployment.fragment.project.userId !== ctx.userId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      // TODO: Optionally delete from Railway as well
      // const railway = await createRailwayAPI(ctx.userId);
      // await railway.deleteProject(deployment.railwayProjectId);

      await ctx.prisma.deployment.delete({
        where: { id: input.deploymentId },
      });

      return { success: true, message: "Deployment deleted" };
    }),

  // Update custom domain
  updateCustomDomain: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        customDomain: z.string().min(1, "Domain is required"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify ownership
      const deployment = await ctx.prisma.deployment.findUnique({
        where: { id: input.deploymentId },
        include: {
          fragment: {
            include: {
              project: true,
            },
          },
        },
      });

      if (!deployment || deployment.fragment.project.userId !== ctx.userId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found",
        });
      }

      if (deployment.status !== "LIVE") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Can only add custom domain to live deployments",
        });
      }

      try {
        // Add domain to Railway
        const railway = await createRailwayAPI(ctx.userId);
        await railway.addCustomDomain(
          deployment.railwayServiceId,
          input.customDomain
        );

        // Update deployment record
        const updatedDeployment = await ctx.prisma.deployment.update({
          where: { id: input.deploymentId },
          data: { customDomain: input.customDomain },
        });

        return updatedDeployment;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Failed to add custom domain. Please check the domain configuration.",
        });
      }
    }),
});

export type DeploymentRouter = typeof deploymentRouter;
