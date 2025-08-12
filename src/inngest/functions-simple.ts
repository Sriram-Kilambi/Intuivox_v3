/**
 * SIMPLIFIED AgentKit Networks Implementation
 * Following AgentKit's design principles properly
 */

import {
  openai,
  createAgent,
  createNetwork,
  createState,
  createTool,
} from "@inngest/agent-kit";
import { Sandbox } from "@e2b/code-interpreter";
import { inngest } from "./client";
import { getSandboxWithFallback } from "./utils";
import { z } from "zod";
import {
  BUSINESS_INFO_GATHERER_PROMPT,
  FRAGMENT_TITLE_PROMPT,
  PROMPT,
  RESPONSE_PROMPT,
} from "@/prompt";
import { prisma } from "@/lib/db";
import { SANDBOX_TIMEOUT } from "./constants";
import { intuivoxHistoryAdapter } from "./history-adapter";

// Feature flags
const ENABLE_HISTORY = process.env.ENABLE_AGENTKIT_HISTORY === 'true';

// SIMPLIFIED AgentState - only what we actually need
interface SimpleAgentState {
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
}

// Simple ask user question tool
export const askUserQuestionTool = createTool({
  name: "ask_user_question",
  description: "Ask the user a question",
  parameters: z.object({
    question: z.string().describe("The question to ask the user"),
  }),
  handler: async ({ question }, { step, network }) => {
    const projectId = network?.state?.data?.projectId;

    await step?.sendEvent(
      { id: "event-user-question" },
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

// SIMPLIFIED Code Agent Function  
export const codeAgentFunction = inngest.createFunction(
  { 
    id: "code-agent",
    // Stronger concurrency control
    concurrency: {
      key: "event.data.projectId",
      limit: 1
    },
    // Add debounce to prevent rapid duplicate calls
    debounce: {
      key: "event.data.projectId", 
      period: "10s"
    }
  },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    console.log(`🚀 SIMPLE-AGENT: Starting for project ${event.data.projectId}`);
    console.log(`📝 SIMPLE-AGENT: User input: "${event.data.value}"`);

    // Create sandbox
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("intuivox-nextjs-test-2");
      await sandbox.setTimeout(SANDBOX_TIMEOUT);
      return sandbox.sandboxId;
    });

    // Load existing messages only if history is disabled
    const previousMessages = ENABLE_HISTORY ? [] : await step.run(
      "get-previous-messages",
      async () => {
        const messages = await prisma.message.findMany({
          where: { projectId: event.data.projectId },
          orderBy: { createdAt: "desc" },
          take: 5,
        });

        return messages.reverse().map(msg => ({
          type: "text",
          role: msg.role === "ASSISTANT" ? "assistant" : "user", 
          content: msg.content,
        }));
      }
    );

    // SIMPLE state initialization
    const state = createState<SimpleAgentState>(
      {
        projectId: event.data.projectId,
        sandboxId: sandboxId,
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
        ...(ENABLE_HISTORY && { threadId: event.data.projectId })
      }
    );

    // SIMPLE business info gatherer - just collects info
    const businessInfoGathererAgent = createAgent<SimpleAgentState>({
      name: "business-info-gatherer-agent", 
      description: "An expert business info gatherer agent",
      system: BUSINESS_INFO_GATHERER_PROMPT,
      model: openai({ model: "gpt-4o" }),
      tools: [askUserQuestionTool],
      lifecycle: {
        onResponse: async ({ result, network }) => {
          const lastMessage = result.output?.[0]?.content;
          
          if (lastMessage && network && typeof lastMessage === 'string') {
            // Look for structured business info
            if (lastMessage.includes("<business_info>")) {
              const businessInfoMatch = lastMessage.match(
                /<business_info>([\s\S]*?)<\/business_info>/
              );
              if (businessInfoMatch) {
                try {
                  const parsedBusinessInfo = JSON.parse(businessInfoMatch[1]);
                  network.state.data.businessInfo = {
                    ...network.state.data.businessInfo,
                    ...parsedBusinessInfo,
                  };
                  console.log("✅ SIMPLE-AGENT: Business info updated", parsedBusinessInfo);
                } catch (error) {
                  console.warn("⚠️ SIMPLE-AGENT: Could not parse business info JSON");
                }
              }
            }
          }
          return result;
        },
      },
    });

    // SIMPLE code agent - just generates code
    const codeAgent = createAgent<SimpleAgentState>({
      name: "code-agent",
      description: "An expert coding agent", 
      system: PROMPT,
      model: openai({ 
        model: "gpt-4.1",
        defaultParameters: { temperature: 0.1 },
      }),
      tools: [
        // Terminal tool
        createTool({
          name: "terminal",
          description: "Use the terminal to run commands",
          parameters: z.object({ command: z.string() }),
          handler: async ({ command }, { step, network }) => {
            return await step?.run("terminal", async () => {
              try {
                const currentSandboxId = network.state.data.sandboxId;
                const currentFiles = network.state.data.files || {};
                const { sandbox } = await getSandboxWithFallback(currentSandboxId, currentFiles);
                const result = await sandbox.commands.run(command);
                return result.stdout;
              } catch (err) {
                return `Command failed: ${err}`;
              }
            });
          },
        }),
        
        // File operations tool
        createTool({
          name: "createOrUpdateFiles",
          description: "Create or update files in the sandbox",
          parameters: z.object({
            files: z.array(z.object({
              path: z.string(),
              content: z.string(),
            })),
          }),
          handler: async ({ files }, { step, network }) => {
            await step?.run("createOrUpdateFiles", async () => {
              try {
                const updatedFiles = network.state.data.files || {};
                const currentSandboxId = network.state.data.sandboxId;
                const { sandbox } = await getSandboxWithFallback(currentSandboxId, updatedFiles);
                
                for (const file of files) {
                  await sandbox.files.write(file.path, file.content);
                  updatedFiles[file.path] = file.content;
                }
                
                network.state.data.files = updatedFiles;
                return updatedFiles;
              } catch (e) {
                return "Error: " + e;
              }
            });
          },
        }),

        // Read files tool  
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
                const { sandbox } = await getSandboxWithFallback(currentSandboxId, currentFiles);
                
                const contents = [];
                for (const file of files) {
                  const content = await sandbox.files.read(file);
                  contents.push({ path: file, content });
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
          const lastMessage = result.output?.[0]?.content;
          
          if (lastMessage && network && typeof lastMessage === 'string') {
            if (lastMessage.includes("<task_summary>")) {
              network.state.data.summary = lastMessage;
              console.log("✅ SIMPLE-AGENT: Task completed with summary");
            }
          }
          return result;
        },
      },
    });

    // SIMPLE network with SIMPLE router
    console.log(`🏗️ SIMPLE-AGENT: Creating network with history ${ENABLE_HISTORY ? 'ENABLED' : 'DISABLED'}`);
    
    const networkConfig = {
      name: "simple-coding-network",
      agents: [codeAgent, businessInfoGathererAgent],
      maxIter: 15,
      defaultState: state,
      
      // SIMPLE router - just the essentials
      router: async ({ network }: { network: any }) => {
        const summary = network.state.data.summary;
        if (summary) {
          console.log("🏁 SIMPLE-ROUTER: Task complete, stopping");
          return null;
        }

        const businessInfo = network.state.data.businessInfo;
        
        // SIMPLE completion check - just require name and description  
        const isBusinessInfoComplete = !!(
          businessInfo.businessName && 
          businessInfo.businessDescription
        );

        console.log(`🧭 SIMPLE-ROUTER: Business info complete: ${isBusinessInfoComplete}`);

        if (!isBusinessInfoComplete) {
          console.log("➡️ SIMPLE-ROUTER: Routing to business-info-gatherer");
          return businessInfoGathererAgent;
        }

        console.log("➡️ SIMPLE-ROUTER: Routing to code-agent");
        return codeAgent;
      },
      
      // Add history if enabled
      ...(ENABLE_HISTORY && { history: intuivoxHistoryAdapter })
    };

    const network = createNetwork<SimpleAgentState>(networkConfig);

    // Run the network
    console.log(`🚀 SIMPLE-AGENT: Starting network execution`);
    const result = await network.run(event.data.value, { state });
    
    console.log("✅ SIMPLE-AGENT: Network execution completed");

    // Generate response (simplified)
    const isError = !result.state.data.summary || Object.keys(result.state.data.files || {}).length === 0;

    // Get sandbox URL
    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const currentSandboxId = result.state.data.sandboxId;
      const currentFiles = result.state.data.files || {};
      const { sandbox } = await getSandboxWithFallback(currentSandboxId, currentFiles);
      const host = sandbox.getHost(3000);
      return `https://${host}`;
    });

    // Save result
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

      return await prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: "I've created your website!",
          role: "ASSISTANT",
          type: "RESULT", 
          fragment: {
            create: {
              sandboxUrl: sandboxUrl,
              title: "Generated Website", 
              files: result.state.data.files,
            },
          },
        },
      });
    });

    return {
      url: sandboxUrl,
      title: "Generated Website",
      files: result.state.data.files,
      summary: result.state.data.summary,
    };
  }
);

// Handle user questions from agents
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