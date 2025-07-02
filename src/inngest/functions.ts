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
import { USER_RESPONSE_EVENT } from "./events";

interface AgentState {
  businessInfo: {
    name: string;
    description: string;
    industry: string;
    subIndustry: string;
    address: string;
    contactInfo: string;
  };
  websiteSitemap: {
    sections: string[];
  };
  isComingSoonTemplate: boolean;
  summary: string;
  files: {
    [path: string]: string;
  };
  waitingForUserResponse: boolean;
  currentQuestion: string;
  askedQuestions: string[];
  responses: Record<string, string>;
  currentStep: number;
}

export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    console.log(
      `Starting code agent function for project ${event.data.projectId}`
    );

    // Check if there's already a workflow running for this project
    const isWorkflowRunning = await step.run(
      "check-workflow-status",
      async () => {
        try {
          // Check if there are any QUESTION type messages without a corresponding user response
          const unansweredQuestions = await prisma.message.findMany({
            where: {
              projectId: event.data.projectId,
              role: "ASSISTANT",
              type: "QUESTION",
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          });

          // If there's a recent question without an answer, don't start a new workflow
          if (unansweredQuestions.length > 0) {
            const mostRecentQuestion = unansweredQuestions[0];
            const userResponse = await prisma.message.findFirst({
              where: {
                projectId: event.data.projectId,
                role: "USER",
                createdAt: {
                  gt: mostRecentQuestion.createdAt,
                },
              },
            });

            if (!userResponse) {
              console.log(
                `Found unanswered question: "${mostRecentQuestion.content}". Not starting new workflow.`
              );
              return true;
            }
          }

          return false;
        } catch (error) {
          console.error("Error checking workflow status:", error);
          return false;
        }
      }
    );

    if (isWorkflowRunning) {
      console.log(
        `Workflow already in progress for project ${event.data.projectId}. Skipping.`
      );
      return {
        skipped: true,
        reason: "Workflow already in progress",
        projectId: event.data.projectId,
      };
    }

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
        businessInfo: {
          name: "",
          description: "",
          industry: "",
          subIndustry: "",
          address: "",
          contactInfo: "",
        },
        websiteSitemap: {
          sections: [],
        },
        isComingSoonTemplate: false,
        summary: "",
        files: {},
        waitingForUserResponse: false,
        currentQuestion: "",
        askedQuestions: [],
        responses: {},
        currentStep: 0,
      },
      {
        messages: previousMessages,
      }
    );

    const businessInfoGathererAgent = createAgent<AgentState>({
      name: "business-info-gatherer",
      description:
        "An expert agent that gathers user's business information and website sitemap requirements.",
      system: BUSINESS_INFO_GATHERER_PROMPT,
      model: openai({
        model: "gpt-4o",
        defaultParameters: {
          temperature: 0.3,
        },
      }),
      tools: [
        createTool({
          name: "askUserQuestion",
          description: "Ask the user a question and wait for their response",
          parameters: z.object({
            question: z.string(),
            questionId: z.string().optional(),
          }),
          handler: async ({ question, questionId }, { step, network }) => {
            console.log("Asking user question:", question);
            console.log("Project ID:", event.data.projectId);

            // Generate a consistent ID for this question if not provided
            const qId =
              questionId ||
              `q-${network?.state.data.askedQuestions.length || 0}`;

            try {
              // Check if we've already asked this question
              if (network?.state.data.askedQuestions.includes(question)) {
                console.log(
                  "Question already asked, retrieving previous response"
                );
                const previousResponse =
                  network?.state.data.responses[question];
                if (previousResponse) {
                  return previousResponse;
                }
                console.log("No previous response found, asking again");
              }

              // Store the question in the network state
              if (network) {
                network.state.data.waitingForUserResponse = true;
                network.state.data.currentQuestion = question;
                // Add to asked questions list
                if (!network.state.data.askedQuestions.includes(question)) {
                  network.state.data.askedQuestions.push(question);
                  network.state.data.currentStep++;
                }
                console.log(
                  "Set waiting state in network:",
                  network.state.data.waitingForUserResponse
                );
                console.log("Current step:", network.state.data.currentStep);
                console.log(
                  "Asked questions:",
                  network.state.data.askedQuestions
                );
              } else {
                console.warn(
                  "Network is undefined when trying to set waiting state"
                );
              }

              // Save the question as an assistant message
              const savedMessage = await prisma.message.create({
                data: {
                  projectId: event.data.projectId,
                  content: question,
                  role: "ASSISTANT",
                  type: "QUESTION",
                  metadata: {
                    questionId: qId,
                    step: network?.state.data.currentStep,
                  },
                },
              });
              console.log("Saved question message with ID:", savedMessage.id);

              // Wait for user response event
              console.log(
                `Waiting for user response for question ID: ${savedMessage.id}`
              );

              // Use a simple event matching approach
              const response = await step?.waitForEvent("user.response", {
                event: USER_RESPONSE_EVENT,
                timeout: "24h",
                match: `data.questionId == "${savedMessage.id}"`,
              });

              console.log("Received user response event:", response);

              if (!response) {
                console.log("No user response received within timeout");
                return "No response received. Please try again.";
              }

              // Reset waiting state and store response
              if (network) {
                network.state.data.waitingForUserResponse = false;
                // Store this response for the question
                network.state.data.responses[question] = response.data.response;
                console.log("Reset waiting state");
                console.log("Updated responses:", network.state.data.responses);
              }

              console.log("User response processed:", response.data.response);
              return response.data.response;
            } catch (error) {
              console.error("Error in askUserQuestion handler:", error);
              return "Error processing your question. Please try again.";
            }
          },
        }),
        createTool({
          name: "storeBusinessInfo",
          description: "Store the business information in the state",
          parameters: z.object({
            name: z.string(),
            description: z.string(),
            industry: z.string(),
            subIndustry: z.string(),
            address: z.string(),
            contactInfo: z.string(),
          }),
          handler: async (
            { name, description, industry, subIndustry, address, contactInfo },
            { step }
          ) => {
            console.log("Storing business info:", {
              name,
              industry,
              subIndustry,
            });

            return await step?.run("storeBusinessInfo", async () => {
              network.state.data.businessInfo = {
                name,
                description,
                industry,
                subIndustry,
                address,
                contactInfo,
              };
              console.log("Business info stored successfully");
            });
          },
        }),
        createTool({
          name: "storeWebsiteSitemap",
          description: "Store the website sitemap requirements in the state",
          parameters: z.object({
            sections: z.array(z.string()),
          }),
          handler: async ({ sections }, { step }) => {
            console.log("Storing website sitemap:", sections);

            return await step?.run("storeWebsiteSitemap", async () => {
              network.state.data.websiteSitemap = {
                sections,
              };
              console.log("Website sitemap stored successfully");
            });
          },
        }),
        createTool({
          name: "storeIsComingSoonTemplate",
          description:
            "Store the information if user wants a coming soon template",
          parameters: z.object({
            isComingSoonTemplate: z.boolean(),
          }),
          handler: async ({ isComingSoonTemplate }, { step }) => {
            console.log(
              "Storing coming soon template preference:",
              isComingSoonTemplate
            );

            return await step?.run("storeIsComingSoonTemplate", async () => {
              network.state.data.isComingSoonTemplate = isComingSoonTemplate;
              console.log(
                "Coming soon template preference stored successfully"
              );
            });
          },
        }),
      ],
      // lifecycle: {
      //   onResponse: async ({ result, network }) => {
      //     const lastAssistantMessageText =
      //       lastAssistantTextMessageContent(result);
      //   }
      // }
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

          console.log(lastAssistantMessageText);

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
        console.log("Router running, current state:", {
          waitingForResponse: network.state.data.waitingForUserResponse,
          hasBusinessInfo: Boolean(network.state.data.businessInfo?.name),
          hasSummary: Boolean(network.state.data.summary),
        });

        // If we're waiting for a user response, don't route to any agent
        if (network.state.data.waitingForUserResponse) {
          console.log("Waiting for user response, pausing agent routing");
          return undefined; // Return undefined to pause routing
        }

        // Check if we need to gather business info
        if (
          network.state.data.businessInfo.name == "" ||
          network.state.data.businessInfo.description == "" ||
          network.state.data.businessInfo.industry == "" ||
          network.state.data.businessInfo.subIndustry == "" ||
          network.state.data.businessInfo.address == "" ||
          network.state.data.businessInfo.contactInfo == ""
        ) {
          console.log(
            "Business info incomplete, routing to businessInfoGathererAgent"
          );
          return businessInfoGathererAgent;
        }

        const summary = network.state.data.summary;
        if (summary) {
          console.log("Summary exists, no more routing needed");
          return undefined; // Return undefined to end routing
        }

        console.log("Routing to codeAgent");
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

export const handleUserResponseFunction = inngest.createFunction(
  { id: "handle-user-response" },
  { event: USER_RESPONSE_EVENT },
  async ({ event, step }) => {
    console.log(`Received user response for project ${event.data.projectId}`);
    console.log(`Response content: ${event.data.response}`);
    console.log(`Question ID: ${event.data.questionId || "unknown"}`);

    try {
      // Store the user response in the database
      await step.run("store-user-response", async () => {
        const message = await prisma.message.create({
          data: {
            projectId: event.data.projectId,
            content: event.data.response,
            role: "USER",
            type: "RESULT",
            metadata: {
              respondingTo: event.data.questionId,
              questionContent: event.data.questionContent,
            },
          },
        });

        console.log("User response stored in database with ID:", message.id);
      });

      // Make sure to return exactly the event format expected by waitForEvent
      // This is critical - the event structure must match exactly what waitForEvent expects
      const responseEvent = {
        name: "user.response", // This should match what waitForEvent is looking for
        data: {
          // Include all fields from the original event to ensure proper matching
          projectId: event.data.projectId,
          response: event.data.response,
          questionId: event.data.questionId,
          questionContent: event.data.questionContent,
          questionMetadata: event.data.questionMetadata,
        },
      };

      console.log("User response handling completed successfully");
      console.log("Returning response event for waitForEvent:", responseEvent);

      return {
        success: true,
        projectId: event.data.projectId,
        responseEvent,
      };
    } catch (error) {
      console.error("Error handling user response:", error);
      return {
        success: false,
        error: "Failed to process user response",
      };
    }
  }
);
