import { inngest } from "@/inngest/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const responseSchema = z.object({
  answer: z.string().min(1, "Answer is required"),
  projectId: z.string().min(1, "Project ID is required"),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { answer, projectId } = responseSchema.parse(body);

    // Send the user response back to Inngest
    await inngest.send({
      name: "app/user-agent-response",
      data: {
        answer,
        projectId,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error handling user response:", error);
    return NextResponse.json(
      { error: "Failed to process response" },
      { status: 500 }
    );
  }
}
