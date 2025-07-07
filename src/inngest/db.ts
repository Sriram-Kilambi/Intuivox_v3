import type {
  State,
  NetworkRun,
  AgentResult,
  StateData,
} from "@inngest/agent-kit";
import { prisma } from "@/lib/db"; // Your database client
import { MessageRole, MessageType } from "@/generated/prisma";
import { lastAssistantTextMessageContent } from "./utils";

// AgentState interface matching the one used in functions.ts
interface AgentState {
  projectId: string;
  sandboxId: string;
  businessInfo: {
    businessName: string;
    businessDescription: string;
    businessIndustry: string;
    businessSubIndustry: string;
    businessAddress: string;
    businessContactInfo: string;
  };
  summary: string;
  files: {
    [path: string]: string;
  };
  hasProjectFinalized?: boolean;
}

// Helper function to validate project ownership and thread access
async function validateProjectAndThreadOwnership(
  projectId: string,
  threadId?: string
): Promise<{ userId: string }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });

  if (!project) {
    throw new Error(`Project with ID ${projectId} not found`);
  }

  // If threadId is provided, validate thread ownership
  if (threadId) {
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      select: { userId: true },
    });

    if (!thread || thread.userId !== project.userId) {
      throw new Error(
        "Unauthorized: Thread does not belong to the project owner"
      );
    }
  }

  return { userId: project.userId };
}

interface HistoryConfig<T extends StateData> {
  /**
   * Creates a new conversation thread.
   * Invoked at the start of a run if no `threadId` exists in the state.
   */
  createThread?: (ctx: {
    state: State<T>; // The current state, including your custom data
    input: string; // The user's input string
    network?: NetworkRun<T>; // The network instance (if applicable)
    step?: unknown; // Inngest step tools for durable execution
  }) => Promise<{ threadId: string }>;

  /**
   * Retrieves conversation history from your database.
   * Invoked after thread initialization if no history is provided by the client.
   */
  get?: (ctx: {
    threadId?: string; // The ID of the conversation thread (optional)
    state: State<T>;
    input: string;
    network: NetworkRun<T>;
    step?: unknown;
  }) => Promise<any[]>;

  /**
   * Saves new messages to your database after a run.
   * Invoked at the end of a successful agent or network run.
   */
  appendResults?: (ctx: {
    threadId?: string;
    newResults: any[]; // The new results generated during this run
    userMessage?: { content: string; role: "user"; timestamp: Date }; // The user's message
    state: State<T>;
    input: string;
    network: NetworkRun<T>;
    step?: unknown;
  }) => Promise<void>;
}

// Define your history adapter with all three methods
// This adapter integrates Inngest AgentKit with Prisma for conversation history management
// ✅ createThread: Creates new conversation threads with proper user ID from project ownership
// ✅ get: Loads conversation history with security validation (user can only access their own threads)
// ✅ appendResults: Saves agent responses and user messages with ownership validation
// 🔒 Security: All operations validate that the user owns the project and associated threads
export const conversationHistoryAdapter: HistoryConfig<AgentState> = {
  // 1. Create new conversation threads (or reuse existing active thread)
  createThread: async ({ state, input }) => {
    try {
      // Validate project ownership and get the userId
      const { userId } = await validateProjectAndThreadOwnership(
        state.data.projectId
      );

      // Check if project already has an active thread
      const project = await prisma.project.findUnique({
        where: { id: state.data.projectId },
        select: {
          activeThreadId: true,
          activeThread: {
            select: { id: true, title: true },
          },
        },
      });

      // If project has an active thread, reuse it
      if (project?.activeThreadId && project.activeThread) {
        console.log(
          `Reusing existing active thread ${project.activeThreadId} for project ${state.data.projectId}`
        );
        return { threadId: project.activeThreadId };
      }

      // Create new thread if no active thread exists
      const thread = await prisma.thread.create({
        data: {
          userId: userId,
          title: input.slice(0, 50), // First 50 chars as title
        },
      });

      // Set this thread as the active thread for the project
      await prisma.project.update({
        where: { id: state.data.projectId },
        data: { activeThreadId: thread.id },
      });

      console.log(
        `Created new conversation thread ${thread.id} and set as active for project ${state.data.projectId}`
      );
      return { threadId: thread.id };
    } catch (error) {
      console.error("Error creating/retrieving conversation thread:", error);
      throw error;
    }
  },

    // 2. Load conversation history
  get: async ({ threadId, state, input }) => {
    console.log(
      `🔍 Conversation history adapter GET called for thread ${threadId}`
    );
    console.log(`🔍 Project ID: ${state.data.projectId}`);
    console.log(`🔍 Input: ${input.substring(0, 100)}...`);
    
    if (!threadId) {
      console.log(`⚠️ No threadId provided, returning empty history`);
      return [];
    }

    // Security check: Verify the thread belongs to the user who owns the project
    await validateProjectAndThreadOwnership(state.data.projectId, threadId);

    const messages = await prisma.message.findMany({
      where: { 
        threadId,
        // Include both regular assistant messages and agent questions
        type: {
          in: ["RESULT", "AGENT_QUESTION", "ERROR"],
        },
      },
      orderBy: { createdAt: "asc" },
    });

    console.log(
      `📚 Loading ${messages.length} messages from thread ${threadId} for conversation history`
    );

    // Transform database records to AgentResult format
    // Based on AgentKit structure seen in the codebase
    const agentResults: any[] = [];

    for (const message of messages) {
      // Only include assistant messages in conversation history
      if (
        !message ||
        !message.content ||
        message.role !== MessageRole.ASSISTANT
      ) {
        console.log(`⚠️ Skipping message: ${message?.id || "unknown"} (role: ${message?.role})`);
        continue;
      }

      try {
        // Create AgentResult-like object with minimal required structure
        // AgentResult has private properties, so we'll create a compatible object
        const agentResult = {
          agentName: message.agentName || 
            (message.type === "AGENT_QUESTION" ? "business-info-gatherer-agent" : "code-agent"),
          output: [
            {
              type: "text",
              role: "assistant",
              content: message.content,
            },
          ],
          createdAt: message.createdAt,
          toolCalls: [],
          // Add minimal required properties to match AgentResult interface
        } as any; // Use any to bypass the private properties issue

        agentResults.push(agentResult);
        console.log(
          `📝 Added ${message.type} message from ${agentResult.agentName} to conversation history`
        );

        // Log if this message contains business info
        if (message.content.includes("<business_info>")) {
          console.log(
            `🏢 Found business info in message: ${message.content.substring(0, 200)}...`
          );
        }
      } catch (error) {
        console.error(
          `❌ Error creating AgentResult for message ${message.id}:`,
          error
        );
      }
    }

    console.log(
      `✅ Retrieved ${agentResults.length} agent results for thread ${threadId}`
    );
    return agentResults;
  },

  // 3. Save new messages
  appendResults: async ({ threadId, newResults, userMessage, state }) => {
    if (!threadId) return;

    // Security check: Verify the thread belongs to the user who owns the project
    await validateProjectAndThreadOwnership(state.data.projectId, threadId);

    // Extract projectId from state - now we know it's AgentState
    const projectId = state.data.projectId;

    console.log(
      `📝 appendResults called for thread ${threadId} with ${newResults.length} results`
    );

    // Save user message only if it doesn't already exist to prevent duplicates
    if (userMessage) {
      const existingUserMessage = await prisma.message.findFirst({
        where: {
          threadId,
          content: userMessage.content,
          role: MessageRole.USER,
          createdAt: {
            gte: new Date(Date.now() - 60000), // Within last minute
          },
        },
      });

      if (!existingUserMessage) {
        await prisma.message.create({
          data: {
            threadId,
            role: MessageRole.USER,
            content: userMessage.content,
            type: MessageType.RESULT,
            projectId: projectId,
          },
        });
        console.log(`Saved user message to thread ${threadId}`);
      } else {
        console.log(`Skipped duplicate user message in thread ${threadId}`);
      }
    }

    // 🚫 SKIP SAVING ASSISTANT MESSAGES HERE - they are already saved by the main function with fragments
    // The main codeAgentFunction saves messages in the 'save-result' step which includes fragment creation
    // Saving here would create duplicates without fragments
    console.log(
      `🚫 Skipping assistant message saves - handled by main function with fragments`
    );
    console.log(
      `   This prevents duplicates since the save-result step already saves with fragments`
    );

    console.log(
      `✅ appendResults completed for thread ${threadId} - user messages handled, assistant messages skipped to prevent duplicates`
    );
  },
};

// Export as default for the import in functions.ts
export default conversationHistoryAdapter;
