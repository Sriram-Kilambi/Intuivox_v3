import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/db";
import { consumeCredits } from "@/lib/usage";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Sandbox } from "@e2b/code-interpreter";
import { SANDBOX_TIMEOUT } from "@/inngest/constants";

export const messagesRouter = createTRPCRouter({
  getMany: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, { message: "Project ID is required" }),
      })
    )
    .query(async ({ input, ctx }) => {
      const messages = await prisma.message.findMany({
        where: {
          projectId: input.projectId,
          project: {
            userId: ctx.auth.userId,
          }
        },
        orderBy: {
          updatedAt: "asc",
        },
        include: {
          fragment: true,
        }
      });

      return messages;
    }),
  create: protectedProcedure
    .input(
      z.object({
        value: z
          .string()
          .min(1, { message: "Value is required" })
          .max(10000, { message: "Value is too long" }),
        projectId: z.string().min(1, { message: "Project ID is required" }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existingProject = await prisma.project.findUnique({
        where: {
          id: input.projectId,
          userId: ctx.auth.userId,
        },
      });

      if (!existingProject) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      try {
        await consumeCredits();
      } catch (error) {
        if (error instanceof Error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Something went wrong"
          })
        } else {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "You have run out of credits"
          })
        }
      }

      const createdMessage = await prisma.message.create({
        data: {
          projectId: existingProject.id,
          content: input.value,
          role: "USER",
          type: "RESULT",
        },
      });

      await inngest.send({
        name: "code-agent/run",
        data: {
          value: input.value,
          projectId: input.projectId,
        },
      });

      return createdMessage;
    }),
  respondToAgent: protectedProcedure
    .input(
      z.object({
        answer: z.string().min(1, { message: "Answer is required" }),
        projectId: z.string().min(1, { message: "Project ID is required" }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existingProject = await prisma.project.findUnique({
        where: {
          id: input.projectId,
          userId: ctx.auth.userId,
        },
      });

      if (!existingProject) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      // Store the user's response as a message
      const responseMessage = await prisma.message.create({
        data: {
          projectId: input.projectId,
          content: input.answer,
          role: "USER",
          type: "RESULT",
        },
      });

      // Send the response back to Inngest
      await inngest.send({
        name: "app/user-agent-response",
        data: {
          answer: input.answer,
          projectId: input.projectId,
          timestamp: new Date().toISOString(),
        },
      });

      return responseMessage;
    }),
  regenerateSandbox: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1, { message: "Project ID is required" }),
        fragmentId: z.string().min(1, { message: "Fragment ID is required" }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const existingProject = await prisma.project.findUnique({
        where: {
          id: input.projectId,
          userId: ctx.auth.userId,
        },
      });

      if (!existingProject) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      }

      // Get the fragment with its files
      const fragment = await prisma.fragment.findUnique({
        where: {
          id: input.fragmentId,
        },
      });

      if (!fragment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Fragment not found",
        });
      }

      try {
        // Create a new sandbox
        const newSandbox = await Sandbox.create("intuivox-nextjs-test-2");
        await newSandbox.setTimeout(SANDBOX_TIMEOUT);

        // Recreate all files from the fragment
        const files = fragment.files as { [path: string]: string } || {};
        
        for (const [path, content] of Object.entries(files)) {
          try {
            await newSandbox.files.write(path, content);
          } catch (fileError) {
            console.error(`Failed to recreate file ${path}:`, fileError);
          }
        }

        // Get the new sandbox URL
        const host = newSandbox.getHost(3000);
        const newSandboxUrl = `https://${host}`;

        // Update the fragment with the new sandbox URL
        const updatedFragment = await prisma.fragment.update({
          where: {
            id: input.fragmentId,
          },
          data: {
            sandboxUrl: newSandboxUrl,
          },
        });

        return {
          success: true,
          newSandboxUrl,
          sandboxId: newSandbox.sandboxId,
          fragment: updatedFragment,
        };
      } catch (error) {
        console.error("Error regenerating sandbox:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to regenerate sandbox",
        });
      }
    }),
});
