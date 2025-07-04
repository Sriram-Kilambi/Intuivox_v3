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
import { getSandbox, lastAssistantTextMessageContent } from "./utils";
import { z } from "zod";
import {
  BUSINESS_INFO_GATHERER_PROMPT,
  FRAGMENT_TITLE_PROMPT,
  PROMPT,
  RESPONSE_PROMPT,
} from "@/prompt";
import { prisma } from "@/lib/db";
import { SANDBOX_TIMEOUT } from "./constants";

interface AgentState {
  projectId: string;
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
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("intuivox-nextjs-test-2");
      await sandbox.setTimeout(SANDBOX_TIMEOUT); // Keep sandbox alive for 30 mins
      return sandbox.sandboxId;
    });

    const previousMessages = await step.run(
      "get-previous-messages",
      async () => {
        const formattedMessages: Message[] = [];

        const messages = await prisma.message.findMany({
          where: {
            projectId: event.data.projectId,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        });

        for (const message of messages) {
          formattedMessages.push({
            type: "text",
            role: message.role === "ASSISTANT" ? "assistant" : "user",
            content: message.content,
          });
        }

        return formattedMessages.reverse();
      }
    );

    const state = createState<AgentState>(
      {
        projectId: event.data.projectId,
        summary: "",
        files: {},
        businessInfo: {
          businessName: "",
          businessDescription: "",
          businessIndustry: "",
          businessSubIndustry: "",
          businessAddress: "",
          businessContactInfo: "",
        },
      },
      {
        messages: previousMessages,
      }
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

                    // Update the state with collected business information
                    network.state.data.businessInfo = {
                      ...network.state.data.businessInfo,
                      ...parsedBusinessInfo,
                    };
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
          handler: async ({ command }, { step }) => {
            return await step?.run("terminal", async () => {
              const buffers = { stdout: "", stderr: "" };

              try {
                const sandbox = await getSandbox(sandboxId);
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
                  const sandbox = await getSandbox(sandboxId);
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
          handler: async ({ files }, { step }) => {
            return await step?.run("readFiles", async () => {
              try {
                const sandbox = await getSandbox(sandboxId);
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
      maxIter: 15,
      defaultState: state,
      router: async ({ network }) => {
        const summary = network.state.data.summary;
        if (summary) {
          return; // Stop the network when we have a summary
        }

        const businessInfo = network.state.data.businessInfo;

        // Check if all required business information is collected
        const isBusinessInfoComplete =
          businessInfo.businessName &&
          businessInfo.businessDescription &&
          businessInfo.businessIndustry &&
          businessInfo.businessSubIndustry &&
          businessInfo.businessAddress &&
          businessInfo.businessContactInfo;

        // If business info is not complete, route to business info gatherer
        if (!isBusinessInfoComplete) {
          return businessInfoGathererAgent;
        }

        // If business info is complete, route to code agent
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
      const sandbox = await getSandbox(sandboxId);
      const host = sandbox.getHost(3000);
      return `https://${host}`;
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
              sandboxUrl: sandboxUrl,
              title: generateFragmentTitle(),
              files: result.state.data.files,
            },
          },
        },
      });
    });

    return {
      url: sandboxUrl,
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
