import { NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { USER_RESPONSE_EVENT } from "@/inngest/events";
import { prisma } from "@/lib/db";

// This is a special testing endpoint to manually trigger a user response event
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const response = url.searchParams.get("response") || "Test response";
    const questionId = url.searchParams.get("questionId");

    if (!projectId) {
      return NextResponse.json(
        { error: "Missing projectId parameter" },
        { status: 400 }
      );
    }

    console.log(
      `TEST ENDPOINT: Triggering user response for project ${projectId}`
    );

    // Get information about the question if questionId is provided
    let questionContent = "";
    let questionMetadata = {};

    if (questionId) {
      try {
        const question = await prisma.message.findUnique({
          where: { id: questionId },
        });

        if (question) {
          questionContent = question.content;
          questionMetadata = question.metadata || {};
          console.log(
            `Found question: "${questionContent.substring(0, 30)}..."`
          );
        } else {
          console.log(`Question with ID ${questionId} not found`);
        }
      } catch (error) {
        console.error("Error fetching question:", error);
      }
    } else {
      // If no specific question ID, try to find the latest question for this project
      try {
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

        if (latestQuestion) {
          questionId = latestQuestion.id;
          questionContent = latestQuestion.content;
          questionMetadata = latestQuestion.metadata || {};
          console.log(
            `Using latest question: ${questionContent.substring(0, 30)}...`
          );
        }
      } catch (error) {
        console.error("Error fetching latest question:", error);
      }
    }

    // Send the response event with all required fields
    const result = await inngest.send({
      name: USER_RESPONSE_EVENT,
      data: {
        projectId,
        response,
        questionId: questionId || `test-question-${Date.now()}`,
        questionContent: questionContent || "Test question content",
        questionMetadata,
        // Add a special flag to help with debugging
        isTestEvent: true,
      },
    });

    console.log("TEST ENDPOINT: Event sent successfully:", result);

    return NextResponse.json({
      success: true,
      message: "Test response event sent",
      projectId,
      response,
      questionId,
      questionContent: questionContent
        ? questionContent.substring(0, 50) + "..."
        : null,
      result,
    });
  } catch (error) {
    console.error("Error in test endpoint:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
