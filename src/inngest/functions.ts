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
import conversationHistoryAdapter from "./db";

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

    await step?.sendEvent(
      {
        id: "event-user-question",
      },
      {
        name: "app/user-agent-question",
        data: {
          question: question,
          projectId: projectId,
        },
      }
    );

    const userAnswer = await step?.waitForEvent("user.response", {
      event: "app/user-agent-response",
      timeout: "4h",
    });

    return {
      answer: userAnswer?.data.answer,
      responseTime: userAnswer?.data.timestamp,
    };
  },
});

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    console.log("=== NEW CODE AGENT RUN STARTED ===");
    console.log("Project ID:", event.data.projectId);
    console.log("User input:", event.data.value);
    console.log("Timestamp:", new Date().toISOString());
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("intuivox-nextjs-test-2");
      await sandbox.setTimeout(SANDBOX_TIMEOUT); // Keep sandbox alive for 30 mins
      return sandbox.sandboxId;
    });

    // Remove manual message loading - let the conversation history adapter handle this
    // The conversation history adapter's get() method will automatically load conversation history
    console.log(
      "📜 Conversation history will be loaded automatically by history adapter"
    );

    // Get the most recent files state from the latest completed fragment
    const mostRecentFiles = await step.run("get-recent-files", async () => {
      try {
        console.log(
          `🔍 Searching for fragments for project: ${event.data.projectId}`
        );

        // First, check how many fragments exist for this project
        const fragmentCount = await prisma.fragment.count({
          where: {
            message: {
              projectId: event.data.projectId,
            },
          },
        });

        console.log(
          `📊 Found ${fragmentCount} total fragments for this project`
        );

        const latestFragment = await prisma.fragment.findFirst({
          where: {
            message: {
              projectId: event.data.projectId,
            },
          },
          orderBy: {
            createdAt: "desc",
          },
          select: {
            id: true,
            files: true,
            createdAt: true,
            message: {
              select: {
                id: true,
                threadId: true,
                role: true,
                type: true,
              },
            },
          },
        });

        if (latestFragment && latestFragment.files) {
          const files = latestFragment.files as Record<string, string>;
          console.log(
            `✅ Restored ${Object.keys(files).length} files from fragment ${
              latestFragment.id
            } (created: ${latestFragment.createdAt}, thread: ${
              latestFragment.message.threadId
            }):`
          );
          console.log(`📁 Files:`, Object.keys(files));
          return files;
        }

        if (latestFragment) {
          console.log(
            `⚠️ Found fragment ${latestFragment.id} but it has no files`
          );
        } else {
          console.log(
            "ℹ️ No fragments found - this might be the first run or there's a data issue"
          );
        }

        return {};
      } catch (error) {
        console.error("❌ Error restoring files from fragments:", error);
        return {};
      }
    });

    // Try to extract business info from previous messages
    const extractedBusinessInfo = await step.run(
      "extract-business-info",
      async () => {
        console.log(
          `🔍 Searching for business info in project: ${event.data.projectId}`
        );

        // Get the active thread for this project to search within
        const project = await prisma.project.findUnique({
          where: { id: event.data.projectId },
          select: { activeThreadId: true },
        });

        if (!project?.activeThreadId) {
          console.log(
            "ℹ️ No active thread found - starting with empty business info"
          );
          return {
            businessName: "",
            businessDescription: "",
            businessIndustry: "",
            businessSubIndustry: "",
            businessAddress: "",
            businessContactInfo: "",
          };
        }

        console.log(`🔍 Searching within thread: ${project.activeThreadId}`);

        // Search for business info within the thread's messages
        const businessInfoMessages = await prisma.message.findMany({
          where: {
            threadId: project.activeThreadId,
            content: {
              contains: "<business_info>",
            },
            role: "ASSISTANT", // Business info is in assistant messages
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
        });

        console.log(
          `📋 Found ${businessInfoMessages.length} messages with business info in thread`
        );

        // Debug: Show all assistant messages in the thread to see what we have
        const allAssistantMessages = await prisma.message.findMany({
          where: {
            threadId: project.activeThreadId,
            role: "ASSISTANT",
          },
          orderBy: {
            createdAt: "desc",
          },
          select: {
            id: true,
            content: true,
            agentName: true,
            type: true,
            createdAt: true,
          },
        });

        console.log(
          `🔍 DEBUG: Found ${allAssistantMessages.length} total assistant messages in thread:`
        );
        allAssistantMessages.forEach((msg, index) => {
          const hasBusinessInfo = msg.content.includes("<business_info>");
          console.log(
            `  ${index + 1}. ${msg.agentName || "unknown"} (${msg.type}) - ${
              hasBusinessInfo ? "🏢 HAS BUSINESS INFO" : "no business info"
            } - ${msg.content.substring(0, 100)}...`
          );
        });

        if (businessInfoMessages.length > 0) {
          try {
            const content = businessInfoMessages[0].content;
            console.log(
              `📄 Business info message content preview: ${content.substring(
                0,
                200
              )}...`
            );

            const businessInfoMatch = content.match(
              /<business_info>([\s\S]*?)<\/business_info>/
            );
            if (businessInfoMatch) {
              const businessInfoText = businessInfoMatch[1].trim();
              console.log(
                `🔍 Extracted business info text: ${businessInfoText}`
              );

              const parsedInfo = JSON.parse(businessInfoText);
              console.log(
                "✅ Successfully restored business info from thread conversation:",
                parsedInfo
              );
              return parsedInfo;
            } else {
              console.log("❌ No business_info tags found in message content");
            }
          } catch (error) {
            console.log("❌ Error parsing business info from history:", error);
          }
        }

        console.log(
          "ℹ️ No previous business info found - starting with empty business info"
        );
        return {
          businessName: "",
          businessDescription: "",
          businessIndustry: "",
          businessSubIndustry: "",
          businessAddress: "",
          businessContactInfo: "",
        };
      }
    );

    const state = createState<AgentState>(
      {
        projectId: event.data.projectId,
        sandboxId: sandboxId,
        summary: "",
        files: mostRecentFiles, // Use restored files instead of empty object
        businessInfo: extractedBusinessInfo, // Use restored business info instead of empty object
        hasProjectFinalized: false,
      }
      // No initial messages - the conversation history adapter will load them automatically
    );

    const businessInfoGathererAgent = createAgent<AgentState>({
      name: "business-info-gatherer-agent",
      description: "An expert business info gatherer agent",
      system: BUSINESS_INFO_GATHERER_PROMPT,
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
                    console.log(
                      "💾 Extracted business info from response:",
                      parsedBusinessInfo
                    );

                    // Update the state with collected business information
                    network.state.data.businessInfo = {
                      ...network.state.data.businessInfo,
                      ...parsedBusinessInfo,
                    };

                    // CRITICAL: Save the raw message with business info tags to database
                    // This ensures the business info extraction can find it later
                    console.log(
                      "💾 Saving raw business info message to preserve <business_info> tags"
                    );

                    // Get current project's active thread
                    const project = await prisma.project.findUnique({
                      where: { id: network.state.data.projectId },
                      select: { activeThreadId: true },
                    });

                    if (project?.activeThreadId) {
                      await prisma.message.create({
                        data: {
                          projectId: network.state.data.projectId,
                          threadId: project.activeThreadId,
                          content: lastAssistantMessageText, // Save with <business_info> tags
                          role: "ASSISTANT",
                          type: "RESULT",
                          agentName: "business-info-gatherer-agent",
                        },
                      });
                      console.log(
                        "✅ Saved raw business info message for future extraction"
                      );
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
            return await step?.run("terminal", async () => {
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

            const newFiles = await step?.run(
              "createOrUpdateFiles",
              async () => {
                try {
                  const updatedFiles = network.state.data.files || {};
                  const currentSandboxId = network.state.data.sandboxId;

                  const { sandbox, newSandboxId } =
                    await getSandboxWithFallback(
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
              }
            );
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
            return await step?.run("readFiles", async () => {
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
            }
          }

          return result;
        },
      },
    });

    const network = createNetwork<AgentState>({
      name: "coding-agent-network",
      agents: [codeAgent, businessInfoGathererAgent],
      maxIter: 25, // Increased to see what's causing the loop
      defaultState: state,
      history: conversationHistoryAdapter,
      router: async ({ network }) => {
        const summary = network.state.data.summary;
        const hasProjectFinalized = network.state.data.hasProjectFinalized;

        console.log("=== ROUTER DEBUG ===");
        console.log("Has summary:", !!summary);
        console.log("Has project finalized:", hasProjectFinalized);
        console.log(
          "Files count:",
          Object.keys(network.state.data.files || {}).length
        );

        // If project is finalized, stop the network with a completion message
        if (hasProjectFinalized) {
          console.log("Project is finalized - stopping network");
          return; // Stop the network when project is finalized
        }

        if (summary) {
          console.log("Summary exists - stopping network");
          return; // Stop the network when we have a summary
        }

        const businessInfo = network.state.data.businessInfo;

        // Check if all required business information is collected
        // Ensure that the fields are not just empty strings, but actually have meaningful content
        const isBusinessInfoComplete =
          businessInfo.businessName &&
          businessInfo.businessName.trim() !== "" &&
          businessInfo.businessDescription &&
          businessInfo.businessDescription.trim() !== "" &&
          businessInfo.businessIndustry &&
          businessInfo.businessIndustry.trim() !== "" &&
          businessInfo.businessSubIndustry &&
          businessInfo.businessSubIndustry.trim() !== "" &&
          businessInfo.businessAddress &&
          businessInfo.businessAddress.trim() !== "" &&
          businessInfo.businessContactInfo &&
          businessInfo.businessContactInfo.trim() !== "";

        console.log("=== BUSINESS INFO CHECK ===");
        console.log(
          "Business Name:",
          businessInfo.businessName
            ? `"${businessInfo.businessName}"`
            : "MISSING/EMPTY"
        );
        console.log(
          "Business Description:",
          businessInfo.businessDescription
            ? `"${businessInfo.businessDescription}"`
            : "MISSING/EMPTY"
        );
        console.log(
          "Business Industry:",
          businessInfo.businessIndustry
            ? `"${businessInfo.businessIndustry}"`
            : "MISSING/EMPTY"
        );
        console.log(
          "Business Sub-Industry:",
          businessInfo.businessSubIndustry
            ? `"${businessInfo.businessSubIndustry}"`
            : "MISSING/EMPTY"
        );
        console.log(
          "Business Address:",
          businessInfo.businessAddress
            ? `"${businessInfo.businessAddress}"`
            : "MISSING/EMPTY"
        );
        console.log(
          "Business Contact:",
          businessInfo.businessContactInfo
            ? `"${businessInfo.businessContactInfo}"`
            : "MISSING/EMPTY"
        );
        console.log(
          "🔍 Raw business info object:",
          JSON.stringify(businessInfo, null, 2)
        );
        console.log("✅ Is Business Info Complete:", isBusinessInfoComplete);

        // Calculate missing fields for logging and routing decisions
        const missing = [];
        if (!businessInfo.businessName?.trim()) missing.push("Business Name");
        if (!businessInfo.businessDescription?.trim())
          missing.push("Business Description");
        if (!businessInfo.businessIndustry?.trim())
          missing.push("Business Industry");
        if (!businessInfo.businessSubIndustry?.trim())
          missing.push("Business Sub-Industry");
        if (!businessInfo.businessAddress?.trim())
          missing.push("Business Address");
        if (!businessInfo.businessContactInfo?.trim())
          missing.push("Business Contact");

        // If business info is incomplete, log what's missing specifically
        if (!isBusinessInfoComplete) {
          console.log("❌ Missing business info fields:", missing.join(", "));
        }

        // If business info is not complete, route to business info gatherer
        // The business info gatherer agent is now conversation-history aware and will
        // check previous conversations before asking questions
        if (!isBusinessInfoComplete) {
          console.log("🔀 ROUTING to business-info-gatherer-agent");
          console.log("   Missing fields:", missing.join(", "));
          return businessInfoGathererAgent;
        }

        // If business info is complete, route to code agent
        return codeAgent;
      },
    });

    // Check if user indicates satisfaction - but only AFTER the website has been built
    // This prevents false positives on initial creation requests
    const checkUserSatisfaction = (
      text: string,
      hasExistingWebsite: boolean
    ) => {
      // Only check for satisfaction if we already have a website (files exist)
      if (!hasExistingWebsite) {
        return false;
      }

      // More specific satisfaction keywords to avoid false positives
      const satisfactionKeywords = [
        "i'm satisfied",
        "looks good",
        "looks great",
        "looks perfect",
        "this is good",
        "this is great",
        "this is perfect",
        "exactly what i wanted",
        "love it",
        "no more changes",
        "no further changes",
        "this is it",
        "final version",
        "ready to launch",
        "ready to go live",
        "i approve this",
        "approved",
        "ship it",
        "publish it",
        "go live with this",
        "this is final",
        "that's perfect",
        "exactly right",
        "spot on",
        "nailed it",
        "couldn't be better",
      ];

      const textLower = text.toLowerCase();
      return satisfactionKeywords.some((keyword) =>
        textLower.includes(keyword)
      );
    };

    // Check user satisfaction - only if we have an existing website
    const hasExistingWebsite = Object.keys(state.data.files || {}).length > 0;
    if (
      checkUserSatisfaction(event.data.value, hasExistingWebsite) &&
      !state.data.hasProjectFinalized
    ) {
      console.log(
        "User expressed satisfaction with the existing website - marking project as finalized"
      );
      state.data.hasProjectFinalized = true;
    }

    console.log("=== NETWORK RUN DEBUG ===");
    console.log("📋 State data preview:", {
      projectId: state.data.projectId,
      hasBusinessInfo: !!state.data.businessInfo,
      filesCount: Object.keys(state.data.files || {}).length,
      hasProjectFinalized: state.data.hasProjectFinalized,
    });
    console.log("📝 User input:", event.data.value);
    console.log("🚀 Starting network.run...");

    let result;
    try {
      result = await network.run(event.data.value, { state });
      console.log("✅ Network.run completed successfully");
    } catch (error) {
      console.error("❌ Network.run failed:", error as Error);
      console.error("❌ Error stack:", (error as Error).stack);
      throw error;
    }
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

    // Debug logging for fragment creation
    console.log("=== FRAGMENT CREATION DEBUG ===");
    console.log("🎯 Project ID:", event.data.projectId);
    console.log("📋 Summary exists:", !!result.state.data.summary);
    console.log(
      "📖 Summary preview:",
      result.state.data.summary?.substring(0, 100) + "..."
    );
    console.log(
      "📁 Files count:",
      Object.keys(result.state.data.files || {}).length
    );
    console.log("📁 Files list:", Object.keys(result.state.data.files || {}));
    console.log(
      "🏁 hasProjectFinalized:",
      result.state.data.hasProjectFinalized
    );
    console.log("🧵 Thread ID:", result.state.threadId);

    const isError =
      !result.state.data.summary ||
      Object.keys(result.state.data.files || {}).length === 0;

    console.log("❌ isError condition:", isError);

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
      console.log("=== SAVE-RESULT STEP ===");
      console.log("isError:", isError);
      console.log("🧵 Thread ID from result:", result.state.threadId);

      if (isError) {
        console.log("Creating ERROR message due to missing summary or files");
        return await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            threadId: result.state.threadId,
            content: "Something went wrong",
            role: "ASSISTANT",
            type: "ERROR",
          },
        });
      }

      console.log("Creating RESULT message with fragment");
      console.log("Fragment title:", generateFragmentTitle());
      console.log("Sandbox URL:", sandboxUrl.url);
      console.log("Files to save:", Object.keys(result.state.data.files || {}));

      try {
        const message = await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            threadId: result.state.threadId,
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
          include: {
            fragment: true, // Include fragment in the response to verify it was created
          },
        });
        console.log("✅ Successfully created message with fragment:");
        console.log("  Message ID:", message.id);
        console.log("  Message type:", message.type);
        console.log("  Message role:", message.role);
        console.log("  Thread ID:", message.threadId);
        console.log("  Fragment ID:", message.fragment?.id);
        console.log("  Fragment title:", message.fragment?.title);
        console.log("  Fragment URL:", message.fragment?.sandboxUrl);
        console.log(
          "  Fragment files count:",
          Object.keys((message.fragment?.files as any) || {}).length
        );
        return message;
      } catch (error) {
        console.error("❌ Error creating message with fragment:", error);
        throw error;
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
  { id: "handle-user-question" },
  { event: "app/user-agent-question" },
  async ({ event }) => {
    console.log("Received user agent question:", event.data.question);

    // Get the active thread for this project
    const project = await prisma.project.findUnique({
      where: { id: event.data.projectId },
      select: { activeThreadId: true },
    });

    // Store the agent's question in the database so the frontend can display it
    await prisma.message.create({
      data: {
        projectId: event.data.projectId,
        threadId: project?.activeThreadId,
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
