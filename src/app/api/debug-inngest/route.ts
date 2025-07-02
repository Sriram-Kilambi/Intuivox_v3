import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { USER_RESPONSE_EVENT } from "@/inngest/events";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") || "test-project-id";
    const response =
      searchParams.get("response") || "Test response from debug endpoint";
    const questionId = searchParams.get("questionId");
    const action = searchParams.get("action") || "send-event";

    // If action is check-state, return the current state for the project
    if (action === "check-state") {
      // Get the most recent question and response for this project
      const latestQuestion = await prisma.message.findFirst({
        where: {
          projectId,
          role: "ASSISTANT",
          type: "QUESTION",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const latestUserMessage = await prisma.message.findFirst({
        where: {
          projectId,
          role: "USER",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const hasUnansweredQuestion =
        latestQuestion &&
        (!latestUserMessage ||
          new Date(latestQuestion.createdAt) >
            new Date(latestUserMessage.createdAt));

      return NextResponse.json({
        success: true,
        projectId,
        state: {
          latestQuestion: latestQuestion
            ? {
                id: latestQuestion.id,
                content: latestQuestion.content,
                createdAt: latestQuestion.createdAt,
                metadata: latestQuestion.metadata,
              }
            : null,
          latestUserMessage: latestUserMessage
            ? {
                id: latestUserMessage.id,
                content: latestUserMessage.content,
                createdAt: latestUserMessage.createdAt,
                metadata: latestUserMessage.metadata,
              }
            : null,
          hasUnansweredQuestion,
          waitingForResponse: hasUnansweredQuestion,
        },
      });
    }

    console.log(
      `Debug endpoint: Sending user response for project ${projectId}`
    );

    // If questionId is provided, get the question details from the database
    let questionContent = "";
    let questionMetadata = {};

    if (questionId) {
      const question = await prisma.message.findUnique({
        where: { id: questionId },
      });

      if (question) {
        questionContent = question.content;
        questionMetadata = question.metadata || {};
      }
    }

    // Send the user response event to Inngest with all required fields
    const result = await inngest.send({
      name: USER_RESPONSE_EVENT,
      data: {
        projectId,
        response,
        questionId: questionId || "test-question-id",
        questionContent: questionContent || "Test question content",
        questionMetadata,
      },
    });

    console.log("Debug endpoint: Event sent to Inngest", result);

    return NextResponse.json({
      success: true,
      message: "Debug event sent to Inngest",
      result,
      sentData: {
        projectId,
        response,
        questionId: questionId || "test-question-id",
        questionContent: questionContent || "Test question content",
      },
    });
  } catch (error) {
    console.error("Debug endpoint error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
