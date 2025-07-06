import {
  openai,
  createAgent,
  createTool,
  createNetwork,
  Tool,
  Message,
  createState,
} from "@inngest/agent-kit";
import { Sandbox } from "@e2b/code-interpreter";

import { inngest } from "./client";
import {
  getSandboxWithFallback,
  lastAssistantTextMessageContent,
} from "./utils";
import { z } from "zod";
import {
  BUSINESS_INFO_GATHERER_PROMPT,
  FRAGMENT_TITLE_PROMPT,
  PROMPT,
  RESPONSE_PROMPT,
} from "@/prompt";
import { prisma } from "@/lib/db";
import { SANDBOX_TIMEOUT } from "./constants";
import { mem0Service } from "@/lib/mem0";

interface AgentState {
  projectId: string;
  sandboxId: string;
  userId: string; // Add userId for Mem0 integration
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
  hasExistingFragments: boolean;
  previousFiles: {
    [path: string]: string;
  };
  memoryContext?: {
    hasBusinessInfo: boolean;
    userIntent: string;
    relevantContext: string[];
    shouldSkipBusinessGathering: boolean;
    previousFragments: number;
  };
}

// With Inngest concurrency control, we no longer need complex global state management

// Define the tool for use in functions
export const askUserQuestionTool = createTool({
  name: "ask_user_question",
  description: "Ask the user a question",
  parameters: z.object({
    question: z.string().describe("The question to ask the user"),
  }),
  handler: async ({ question }, { step, network }) => {
    // Get projectId from the network state
    const projectId = network?.state?.data?.projectId;
    const userId = network?.state?.data?.userId;

    if (!projectId || !userId) {
      throw new Error("Project ID or User ID not found in network state");
    }

    console.log(`[${projectId}] Question request received: ${question}`);

    // With concurrency control, only one instance per project runs at a time
    // So we can simplify the question handling significantly

    const questionId = `${projectId}-${userId}-${Date.now()}-${Math.floor(
      Math.random() * 100000
    )}`;

    // Send the question event
    await step?.sendEvent(
      {
        id: `event-user-question-${questionId}`,
      },
      {
        name: "app/user-agent-question",
        data: {
          question: question,
          projectId: projectId,
          questionId: questionId,
        },
      }
    );

    console.log(
      `[${projectId}] Question sent, waiting for response (ID: ${questionId})...`
    );

    try {
      const userAnswer = await step?.waitForEvent(
        `user-response-${questionId}`,
        {
          event: "app/user-agent-response",
          if: `event.data.projectId == "${projectId}"`,
          timeout: "5h",
        }
      );

      console.log(
        `[${projectId}] Received user answer:`,
        userAnswer?.data.answer
      );

      return {
        answer: userAnswer?.data.answer,
        responseTime: userAnswer?.data.timestamp,
      };
    } catch (error) {
      console.error(`[${projectId}] Error waiting for user response:`, error);
      throw error;
    }
  },
});

export const codeAgentFunction = inngest.createFunction(
  {
    id: "code-agent",
    // Ensure only one network instance runs per project at a time
    concurrency: [
      {
        key: "event.data.projectId",
        limit: 1,
      },
    ],
  },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    // DEBUG: Log function invocation
    console.log(
      `[DEBUG] codeAgentFunction called with projectId: ${
        event.data.projectId
      }, value: ${event.data.value.substring(0, 50)}...`
    );
    console.log(`[DEBUG] Event data:`, JSON.stringify(event.data, null, 2));
    console.log(`[DEBUG] Concurrency key would be: "${event.data.projectId}"`);
    console.log(`[DEBUG] Type of projectId: ${typeof event.data.projectId}`);

    // Add database-level lock to prevent multiple instances
    const lockKey = `agent_running_${event.data.projectId}`;
    const lockAcquired = await step.run("acquire-lock", async () => {
      try {
        // Try to create a lock record in the database
        await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: `LOCK:${lockKey}`,
            role: "ASSISTANT",
            type: "SYSTEM_STATE",
          },
        });
        console.log(
          `[DEBUG] Lock acquired for project ${event.data.projectId}`
        );
        return true;
      } catch {
        // If lock creation fails, another instance is running
        console.log(
          `[DEBUG] Lock NOT acquired for project ${event.data.projectId} - another instance is running`
        );
        return false;
      }
    });

    if (!lockAcquired) {
      console.log(
        `[DEBUG] Exiting - another instance is already running for project ${event.data.projectId}`
      );
      return {
        url: "",
        title: "Skipped",
        files: {},
        summary: "Skipped - another instance running",
      };
    }
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("intuivox-nextjs-test-2");
      await sandbox.setTimeout(SANDBOX_TIMEOUT); // Keep sandbox alive for 30 mins
      return sandbox.sandboxId;
    });

    const {
      previousMessages,
      existingBusinessInfo,
      hasExistingFragments,
      previousFiles,
      userId,
      memoryContext,
    } = await step.run("get-previous-context", async () => {
      const formattedMessages: Message[] = [];

      // Get recent messages for context
      const messages = await prisma.message.findMany({
        where: {
          projectId: event.data.projectId,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 10, // Increased to get more context
      });

      for (const message of messages) {
        formattedMessages.push({
          type: "text",
          role: message.role === "ASSISTANT" ? "assistant" : "user",
          content: message.content,
        });
      }

      // Get existing business info from dedicated table
      const businessInfoRecord = await prisma.businessInfo.findUnique({
        where: {
          projectId: event.data.projectId,
        },
      });

      const businessInfo = {
        businessName: businessInfoRecord?.businessName || "",
        businessDescription: businessInfoRecord?.businessDescription || "",
        businessIndustry: businessInfoRecord?.businessIndustry || "",
        businessSubIndustry: businessInfoRecord?.businessSubIndustry || "",
        businessAddress: businessInfoRecord?.businessAddress || "",
        businessContactInfo: businessInfoRecord?.businessContactInfo || "",
      };

      // Check if we have any existing fragments (meaning business info was collected before)
      const existingFragmentCount = await prisma.fragment.count({
        where: {
          message: {
            projectId: event.data.projectId,
          },
        },
      });

      // Get the most recent fragment's files to share with the LLM
      const mostRecentFragment = await prisma.fragment.findFirst({
        where: {
          message: {
            projectId: event.data.projectId,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const previousFiles =
        (mostRecentFragment?.files as { [path: string]: string }) || {};

      // Get project to access userId
      const project = await prisma.project.findUnique({
        where: { id: event.data.projectId },
      });

      const userId = project?.userId || "anonymous";

      // Get memory context using Mem0 for intelligent routing
      let memoryContext = {
        hasBusinessInfo: false,
        userIntent: "unknown" as string,
        relevantContext: [] as string[],
        shouldSkipBusinessGathering: false,
        previousFragments: 0,
      };

      try {
        memoryContext = await mem0Service.getConversationContext(
          userId,
          event.data.projectId,
          event.data.value
        );
        console.log("Memory context loaded:", memoryContext);
      } catch (error) {
        console.error("Error loading memory context:", error);
      }

      return {
        previousMessages: formattedMessages.reverse(),
        existingBusinessInfo: businessInfo,
        hasExistingFragments: existingFragmentCount > 0,
        previousFiles: previousFiles,
        userId: userId,
        memoryContext: memoryContext,
      };
    });

    const state = createState<AgentState>(
      {
        projectId: event.data.projectId,
        sandboxId: sandboxId,
        userId: userId, // Add userId for Mem0 integration
        summary: "",
        files: previousFiles, // Start with previous files as the base
        businessInfo: existingBusinessInfo, // Use existing business info from previous conversations
        hasExistingFragments: hasExistingFragments, // Track if we've created fragments before
        previousFiles: previousFiles, // Include previous files for context
        memoryContext: memoryContext, // Add memory context from Mem0
      },
      {
        messages: previousMessages,
      }
    );

    const businessInfoGathererAgent = createAgent<AgentState>({
      name: "business-info-gatherer-agent",
      description: "An expert business info gatherer agent",
      system: `${BUSINESS_INFO_GATHERER_PROMPT}

MEMORY CONTEXT:
You have access to memory context that may contain information about previous conversations with this user.
Memory context: ${JSON.stringify(memoryContext)}

If the memory context suggests that business information has already been collected, or if the user is asking for incremental changes to an existing website, you should be more selective about what questions to ask.

Use the relevant context from memory to avoid asking questions that have already been answered in previous conversations.`,
      model: openai({
        model: "gpt-4o",
      }),
      tools: [askUserQuestionTool],
      lifecycle: {
        onResponse: async ({ result, network }) => {
          const lastAssistantMessageText =
            lastAssistantTextMessageContent(result);

          if (lastAssistantMessageText && network) {
            // Look for business info in the assistant's response
            try {
              // Try to extract business info from structured tags in the response
              if (lastAssistantMessageText.includes("<business_info>")) {
                const businessInfoMatch = lastAssistantMessageText.match(
                  /<business_info>([\s\S]*?)<\/business_info>/
                );
                if (businessInfoMatch) {
                  const businessInfoText = businessInfoMatch[1];

                  // Parse the business info (expecting JSON format)
                  try {
                    const parsedBusinessInfo = JSON.parse(businessInfoText);

                    // Update the state with collected business information
                    network.state.data.businessInfo = {
                      ...network.state.data.businessInfo,
                      ...parsedBusinessInfo,
                    };

                    // Save business info to database
                    const projectId = network.state.data.projectId;

                    // Check if all required fields are present
                    const isComplete = !!(
                      parsedBusinessInfo.businessName &&
                      parsedBusinessInfo.businessDescription &&
                      parsedBusinessInfo.businessIndustry &&
                      parsedBusinessInfo.businessSubIndustry &&
                      parsedBusinessInfo.businessAddress &&
                      parsedBusinessInfo.businessContactInfo
                    );

                    // Upsert business info
                    await prisma.businessInfo.upsert({
                      where: {
                        projectId: projectId,
                      },
                      update: {
                        businessName: parsedBusinessInfo.businessName || "",
                        businessDescription:
                          parsedBusinessInfo.businessDescription || "",
                        businessIndustry:
                          parsedBusinessInfo.businessIndustry || "",
                        businessSubIndustry:
                          parsedBusinessInfo.businessSubIndustry || "",
                        businessAddress:
                          parsedBusinessInfo.businessAddress || "",
                        businessContactInfo:
                          parsedBusinessInfo.businessContactInfo || "",
                        isComplete,
                      },
                      create: {
                        projectId: projectId,
                        businessName: parsedBusinessInfo.businessName || "",
                        businessDescription:
                          parsedBusinessInfo.businessDescription || "",
                        businessIndustry:
                          parsedBusinessInfo.businessIndustry || "",
                        businessSubIndustry:
                          parsedBusinessInfo.businessSubIndustry || "",
                        businessAddress:
                          parsedBusinessInfo.businessAddress || "",
                        businessContactInfo:
                          parsedBusinessInfo.businessContactInfo || "",
                        isComplete,
                      },
                    });

                    console.log(
                      "Business info saved to database:",
                      parsedBusinessInfo
                    );

                    // Store business info completion in Mem0 for future reference
                    if (isComplete && network.state.data.userId) {
                      try {
                        await mem0Service.storeBusinessInfoCompletion(
                          network.state.data.userId,
                          projectId,
                          {
                            ...parsedBusinessInfo,
                            isComplete,
                          }
                        );
                        console.log("Business info stored in Mem0 memory");
                      } catch (error) {
                        console.error(
                          "Error storing business info in Mem0:",
                          error
                        );
                      }
                    }
                  } catch {
                    console.log(
                      "Could not parse business info as JSON, skipping..."
                    );
                  }
                }
              }
            } catch (error) {
              console.log("Error processing business info:", error);
            }
          }

          return result;
        },
      },
    });

    // Create a new agent with a system prompt (you can add optional tools, too)
    const codeAgent = createAgent<AgentState>({
      name: "code-agent",
      description: "An expert coding agent",
      system: PROMPT,
      model: openai({
        model: "gpt-4.1",
        defaultParameters: {
          temperature: 0.1,
        },
      }),
      tools: [
        createTool({
          name: "terminal",
          description: "Use the terminal to run commands",
          parameters: z.object({
            command: z.string(),
          }),
          handler: async ({ command }, { step, network }) => {
            const terminalUniqueId = `${
              network.state.data.projectId
            }-terminal-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            return await step?.run(terminalUniqueId, async () => {
              const buffers = { stdout: "", stderr: "" };

              try {
                const currentSandboxId = network.state.data.sandboxId;
                const currentFiles = network.state.data.files || {};

                const { sandbox, newSandboxId } = await getSandboxWithFallback(
                  currentSandboxId,
                  currentFiles
                );

                // Update sandbox ID in state if a new one was created
                if (newSandboxId) {
                  network.state.data.sandboxId = newSandboxId;
                }

                const result = await sandbox.commands.run(command, {
                  onStdout: (data: string) => {
                    buffers.stdout += data;
                  },
                  onStderr: (data: string) => {
                    buffers.stderr += data;
                  },
                });
                return result.stdout;
              } catch (err) {
                console.error(
                  `Command failed: ${err} \nstdout: ${buffers.stdout} \nstderr: ${buffers.stderr}`
                );
                return `Command failed: ${err} \nstdout: ${buffers.stdout} \nstderr: ${buffers.stderr}`;
              }
            });
          },
        }),
        createTool({
          name: "createOrUpdateFiles",
          description: "Create or update files in the sandbox",
          parameters: z.object({
            files: z.array(
              z.object({
                path: z.string(),
                content: z.string(),
              })
            ),
          }),
          handler: async (
            { files },
            { step, network }: Tool.Options<AgentState>
          ) => {
            /**
             * {
             * "app.tsx": "<p>app page</p>",
             * "button.tsx": "<button>click me</button>",
             * }
             */

            const filesUniqueId = `${
              network.state.data.projectId
            }-files-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            const newFiles = await step?.run(filesUniqueId, async () => {
              try {
                const updatedFiles = network.state.data.files || {};
                const currentSandboxId = network.state.data.sandboxId;

                const { sandbox, newSandboxId } = await getSandboxWithFallback(
                  currentSandboxId,
                  updatedFiles
                );

                // Update sandbox ID in state if a new one was created
                if (newSandboxId) {
                  network.state.data.sandboxId = newSandboxId;
                }

                for (const file of files) {
                  await sandbox.files.write(file.path, file.content);
                  updatedFiles[file.path] = file.content;
                }
                return updatedFiles;
              } catch (e) {
                return "Error: " + e;
              }
            });
            if (typeof newFiles === "object") {
              network.state.data.files = newFiles;
            }
          },
        }),
        createTool({
          name: "readFiles",
          description: "Read files from the sandbox",
          parameters: z.object({
            files: z.array(z.string()),
          }),
          handler: async ({ files }, { step, network }) => {
            const readUniqueId = `${
              network.state.data.projectId
            }-read-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            return await step?.run(readUniqueId, async () => {
              try {
                const currentSandboxId = network.state.data.sandboxId;
                const currentFiles = network.state.data.files || {};

                const { sandbox, newSandboxId } = await getSandboxWithFallback(
                  currentSandboxId,
                  currentFiles
                );

                // Update sandbox ID in state if a new one was created
                if (newSandboxId) {
                  network.state.data.sandboxId = newSandboxId;
                }

                const contents = [];
                for (const file of files) {
                  const content = await sandbox.files.read(file);
                  contents.push({
                    path: file,
                    content,
                  });
                }
                return JSON.stringify(contents);
              } catch (e) {
                return "Error: " + e;
              }
            });
          },
        }),
      ],
      lifecycle: {
        onResponse: async ({ result, network }) => {
          const lastAssistantMessageText =
            lastAssistantTextMessageContent(result);

          if (lastAssistantMessageText && network) {
            if (lastAssistantMessageText.includes("<task_summary>")) {
              network.state.data.summary = lastAssistantMessageText;

              // Store successful code generation pattern in memory
              try {
                const userId = network.state.data.userId;
                const projectId = network.state.data.projectId;

                await mem0Service.storeCodePattern(
                  userId,
                  projectId,
                  `Successfully generated code with summary: ${lastAssistantMessageText.substring(
                    0,
                    200
                  )}`,
                  true
                );

                // Store general success pattern
                await mem0Service.storeConversationContext(
                  userId,
                  projectId,
                  "Code generation completed successfully",
                  "code_generation_success"
                );

                console.log("Stored successful code generation in memory");
              } catch (error) {
                console.error("Error storing code pattern in memory:", error);
              }
            }
          }

          return result;
        },
      },
    });

    const network = createNetwork<AgentState>({
      name: "coding-agent-network",
      agents: [codeAgent, businessInfoGathererAgent],
      maxIter: 15,
      defaultState: state,
      router: async ({ network }) => {
        const summary = network.state.data.summary;
        const projectId = network.state.data.projectId;

        console.log(`[${projectId}] Router called - summary: ${!!summary}`);

        if (summary) {
          console.log(`[${projectId}] Network stopping - summary found`);
          return; // Stop the network when we have a summary
        }

        const memoryContext = network.state.data.memoryContext;
        const userId = network.state.data.userId;

        // Enhanced routing using Mem0 memory context
        console.log(
          `[${projectId}] Router using memory context:`,
          memoryContext
        );

        // If memory says we should skip business gathering (e.g., incremental changes)
        if (memoryContext?.shouldSkipBusinessGathering) {
          console.log(
            "Memory context suggests skipping business info gathering - routing to code agent"
          );

          // Store this interaction in memory
          try {
            await mem0Service.storeConversationContext(
              userId,
              projectId,
              "User is making incremental changes, skipped business info gathering",
              "incremental_change"
            );
          } catch (error) {
            console.error("Error storing conversation context:", error);
          }

          return codeAgent;
        }

        // Check business info completeness from database (fallback)
        const businessInfoRecord = await prisma.businessInfo.findUnique({
          where: {
            projectId: projectId,
          },
        });

        const isBusinessInfoComplete = businessInfoRecord?.isComplete || false;
        const hasMemoryBusinessInfo = memoryContext?.hasBusinessInfo || false;

        // Use memory context to make smarter routing decisions
        const shouldUseCodeAgent =
          (isBusinessInfoComplete || hasMemoryBusinessInfo) &&
          (network.state.data.hasExistingFragments ||
            memoryContext?.userIntent === "incremental_change");

        if (shouldUseCodeAgent) {
          console.log(
            "Business info available (database or memory) and user intent understood - routing to code agent"
          );
          return codeAgent;
        }

        // If business info is not complete and memory doesn't suggest otherwise
        if (!isBusinessInfoComplete && !hasMemoryBusinessInfo) {
          console.log(
            "Business info incomplete in both database and memory - routing to business info gatherer"
          );
          return businessInfoGathererAgent;
        }

        // Default to code agent for edge cases
        console.log("Default routing - going to code agent");
        return codeAgent;
      },
    });

    const result = await network.run(event.data.value, { state });
    console.log(result);

    const fragmentTitleGenerator = createAgent({
      name: "fragment-title-generator",
      description: "An expert fragment title generator agent",
      system: FRAGMENT_TITLE_PROMPT,
      model: openai({
        model: "gpt-4o",
      }),
    });

    const responseGenerator = createAgent({
      name: "response-generator",
      description: "An expert response generator agent",
      system: RESPONSE_PROMPT,
      model: openai({
        model: "gpt-4o",
      }),
    });

    const { output: fragmentTitleOutput } = await fragmentTitleGenerator.run(
      result.state.data.summary
    );
    const { output: responseOutput } = await responseGenerator.run(
      result.state.data.summary
    );

    const generateFragmentTitle = () => {
      if (fragmentTitleOutput[0].type !== "text") {
        return "Fragment";
      }

      if (Array.isArray(fragmentTitleOutput[0].content)) {
        return fragmentTitleOutput[0].content.map((text) => text).join("");
      } else {
        return fragmentTitleOutput[0].content;
      }
    };

    const generateResponse = () => {
      if (responseOutput[0].type !== "text") {
        return "Here you go";
      }

      if (Array.isArray(responseOutput[0].content)) {
        return responseOutput[0].content.map((text) => text).join("");
      } else {
        return responseOutput[0].content;
      }
    };

    const isError =
      !result.state.data.summary ||
      Object.keys(result.state.data.files || {}).length === 0;

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const currentSandboxId = result.state.data.sandboxId;
      const currentFiles = result.state.data.files || {};

      const { sandbox, newSandboxId } = await getSandboxWithFallback(
        currentSandboxId,
        currentFiles
      );

      // If a new sandbox was created, we need to save this information
      // but we can't update the result state here, so we'll handle it in save-result
      const finalSandboxId = newSandboxId || currentSandboxId;

      const host = sandbox.getHost(3000);
      return {
        url: `https://${host}`,
        finalSandboxId: finalSandboxId,
      };
    });

    await step.run("save-result", async () => {
      if (isError) {
        return await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: "Something went wrong",
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
      }

      await prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: generateResponse(),
          role: "ASSISTANT",
          type: "RESULT",
          fragment: {
            create: {
              sandboxUrl: sandboxUrl.url,
              title: generateFragmentTitle(),
              files: result.state.data.files,
            },
          },
        },
      });
    });

    // Release the lock
    await step.run("release-lock", async () => {
      try {
        await prisma.message.deleteMany({
          where: {
            projectId: event.data.projectId,
            content: `LOCK:${lockKey}`,
            type: "SYSTEM_STATE",
          },
        });
        console.log(
          `[DEBUG] Lock released for project ${event.data.projectId}`
        );
      } catch {
        console.log(
          `[DEBUG] Failed to release lock for project ${event.data.projectId}`
        );
      }
    });

    return {
      url: sandboxUrl.url,
      title: "Fragment",
      files: result.state.data.files,
      summary: result.state.data.summary,
    };
  }
);

// Add a function to handle user agent questions
export const handleUserQuestion = inngest.createFunction(
  {
    id: "handle-user-question",
    // Ensure only one question handler runs per project at a time
    concurrency: [
      {
        key: "event.data.projectId",
        limit: 1,
      },
    ],
  },
  { event: "app/user-agent-question" },
  async ({ event }) => {
    console.log("Received user agent question:", event.data.question);

    // Store the agent's question in the database so the frontend can display it
    await prisma.message.create({
      data: {
        projectId: event.data.projectId,
        content: event.data.question,
        role: "ASSISTANT",
        type: "AGENT_QUESTION", // New message type for agent questions
      },
    });

    return {
      success: true,
      question: event.data.question,
    };
  }
);
