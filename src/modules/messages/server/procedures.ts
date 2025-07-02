import { inngest } from "@/inngest/client";
import { prisma } from "@/lib/db";
import { consumeCredits } from "@/lib/usage";
import { protectedProcedure, createTRPCRouter } from "@/trpc/init";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { USER_RESPONSE_EVENT } from "@/inngest/events";

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
          },
        },
        orderBy: {
          updatedAt: "asc",
        },
        include: {
          fragment: true,
        },
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
            message: "Something went wrong",
          });
        } else {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "You have run out of credits",
          });
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
  respondToQuestion: protectedProcedure
    .input(
      z.object({
        response: z
          .string()
          .min(1, { message: "Response is required" })
          .max(10000, { message: "Response is too long" }),
        projectId: z.string().min(1, { message: "Project ID is required" }),
        questionId: z.string().optional(),
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

      // Get the question message - either by specific ID or the last one
      const questionMessage = input.questionId
        ? await prisma.message.findFirst({
            where: {
              id: input.questionId,
              projectId: input.projectId,
              role: "ASSISTANT",
              type: "QUESTION",
            },
          })
        : await prisma.message.findFirst({
            where: {
              projectId: input.projectId,
              role: "ASSISTANT",
              type: "QUESTION",
            },
            orderBy: {
              createdAt: "desc",
            },
          });

      if (!questionMessage) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No question to respond to",
        });
      }

      // Create a user message with the response
      const userMessage = await prisma.message.create({
        data: {
          projectId: input.projectId,
          content: input.response,
          role: "USER",
          type: "RESULT",
          metadata: {
            respondingTo: questionMessage.id,
            questionContent: questionMessage.content,
            questionMetadata: questionMessage.metadata || {},
          },
        },
      });

      console.log(
        `Sending user response event for question: ${questionMessage.content.substring(
          0,
          30
        )}...`
      );

      // Send the user response event to Inngest with full context
      await inngest.send({
        name: USER_RESPONSE_EVENT,
        data: {
          projectId: input.projectId,
          response: input.response,
          questionId: questionMessage.id,
          questionContent: questionMessage.content,
          questionMetadata: questionMessage.metadata || {},
        },
        user: {
          userId: ctx.auth.userId,
        },
      });

      return userMessage;
    }),
});
