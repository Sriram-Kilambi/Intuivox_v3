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
import { intuivoxHistoryAdapter } from "./history-adapter";
import { 
  getProjectState, 
  checkExistingBusinessInfo,
  detectProjectPhase,
  isChangeRequest 
} from "./router-intelligence";
import { 
  integrateMemoryLayer,
  learnFromInteraction 
} from "./memory-layer";

// Feature flag for history functionality
const ENABLE_HISTORY = process.env.ENABLE_AGENTKIT_HISTORY === 'true';

// Global context for router access
let currentUserInput = '';
let currentProjectId = '';

/**
 * Extract business information from conversation history messages
 * Enhanced to parse from Q&A messages when structured format isn't available
 */
const extractBusinessInfoFromHistory = (messages: Message[]) => {
  console.log(`🔍 Scanning ${messages.length} history messages for business info`);
  
  // First try to find structured business_info tags (preferred method)
  for (const message of messages) {
    if (message.type === 'text' && message.role === 'assistant') {
      const content = message.content;
      if (typeof content === 'string' && content.includes('<business_info>')) {
        console.log(`📋 Found business_info tags in message`);
        
        const businessInfoMatch = content.match(
          /<business_info>([\s\S]*?)<\/business_info>/
        );
        
        if (businessInfoMatch) {
          try {
            const businessInfoText = businessInfoMatch[1];
            const parsedBusinessInfo = JSON.parse(businessInfoText);
            
            console.log(`✅ Successfully parsed business info from history:`, parsedBusinessInfo);
            return parsedBusinessInfo;
          } catch (error) {
            console.warn(`⚠️ Could not parse business info JSON:`, error);
          }
        }
      }
    }
  }
  
  console.log(`📭 No structured business_info found, trying Q&A parsing...`);
  
  // Fallback: Extract business info from Q&A conversation
  const businessInfo: Partial<AgentState['businessInfo']> = {};
  
  for (let i = 0; i < messages.length - 1; i++) {
    const question = messages[i];
    const answer = messages[i + 1];
    
    if (question.type === 'text' && question.role === 'assistant' && 
        answer.type === 'text' && answer.role === 'user') {
      
      const questionContent = typeof question.content === 'string' ? question.content.toLowerCase() : '';
      const answerContent = typeof answer.content === 'string' ? answer.content : '';
      
      // Extract business name
      if (questionContent.includes('name') && questionContent.includes('business')) {
        businessInfo.businessName = answerContent;
        console.log(`📋 Extracted business name: ${answerContent}`);
      }
      
      // Extract business description
      if (questionContent.includes('tell me') && questionContent.includes('do')) {
        businessInfo.businessDescription = answerContent;
        console.log(`📋 Extracted business description: ${answerContent}`);
      }
      
      // Extract industry info
      if (questionContent.includes('industry')) {
        // Parse "gaming and sub-industry is mobile games" format
        if (answerContent.toLowerCase().includes('industry') && answerContent.toLowerCase().includes('sub-industry')) {
          const industryMatch = answerContent.match(/industry is (\w+)/i);
          const subIndustryMatch = answerContent.match(/sub-industry is ([^.]+)/i);
          
          if (industryMatch) {
            businessInfo.businessIndustry = industryMatch[1];
            console.log(`📋 Extracted industry: ${industryMatch[1]}`);
          }
          if (subIndustryMatch) {
            businessInfo.businessSubIndustry = subIndustryMatch[1].trim();
            console.log(`📋 Extracted sub-industry: ${subIndustryMatch[1].trim()}`);
          }
        }
      }
      
      // Extract address
      if (questionContent.includes('address')) {
        businessInfo.businessAddress = answerContent;
        console.log(`📋 Extracted address: ${answerContent}`);
      }
      
      // Extract contact info
      if (questionContent.includes('contact')) {
        businessInfo.businessContactInfo = answerContent;
        console.log(`📋 Extracted contact: ${answerContent}`);
      }
    }
  }
  
  // Check if we extracted meaningful business info
  const hasBusinessInfo = businessInfo.businessName || businessInfo.businessDescription;
  
  if (hasBusinessInfo) {
    console.log(`✅ Successfully extracted business info from Q&A:`, businessInfo);
    return businessInfo;
  }
  
  console.log(`📭 No business info found in conversation history`);
  return null;
};

/**
 * Phase 2: Routing Decision Logic
 * Determine which agent to route to based on project state
 */
const determineRouting = (projectState: any) => {
  // If project is in NEW phase and we don't have business info
  if (projectState.phase === 'NEW' || !projectState.businessInfo.isComplete) {
    return {
      agent: 'business-info-gatherer',
      reasoning: `Project phase: ${projectState.phase}, Business info complete: ${projectState.businessInfo.isComplete}`
    };
  }

  // If we have business info and this is a change request, go straight to code agent
  if (projectState.businessInfo.isComplete && 
      (projectState.isChangeRequest || projectState.hasGeneratedCode)) {
    return {
      agent: 'code-agent',
      reasoning: `Business info complete, Change request: ${projectState.isChangeRequest}, Has code: ${projectState.hasGeneratedCode}`
    };
  }

  // If we have business info but no code yet, generate initial code
  if (projectState.businessInfo.isComplete && !projectState.hasGeneratedCode) {
    return {
      agent: 'code-agent',
      reasoning: `Business info complete, ready for initial code generation`
    };
  }

  // Default fallback to business info gatherer
  return {
    agent: 'business-info-gatherer',
    reasoning: `Fallback routing - unclear project state`
  };
};

/**
 * Phase 3: Enhanced AgentState Interface
 * Expanded state to track project lifecycle and maintain context
 */
interface AgentState {
  // Core project info
  projectId: string;
  sandboxId: string;
  
  // Business information
  businessInfo: {
    businessName: string;
    businessDescription: string;
    businessIndustry: string;
    businessSubIndustry: string;
    businessAddress: string;
    businessContactInfo: string;
  };
  
  // Project lifecycle tracking
  projectPhase: 'NEW' | 'BUSINESS_INFO' | 'CODE_READY' | 'ITERATING';
  isFirstRun: boolean;
  lastUserInput: string;
  changeRequestContext?: {
    type: 'STYLE' | 'CONTENT' | 'FEATURE' | 'LAYOUT' | 'OTHER';
    description: string;
    targetFiles?: string[];
  };
  
  // Code and file context
  summary: string;
  files: {
    [path: string]: string;
  };
  fileVersions: {
    [path: string]: number;
  };
  lastCodeGeneration?: Date;
  
  // User session context
  conversationTurn: number;
  totalMessages: number;
  lastActivity: Date;
  
  // Performance tracking
  executionHistory: Array<{
    timestamp: Date;
    phase: string;
    agent: string;
    duration?: number;
  }>;
}

/**
 * Phase 3: Context Loading Functions
 * Load project context from database to populate enhanced state
 */
const loadProjectContext = async (projectId: string): Promise<Partial<AgentState>> => {
  console.log(`📚 CONTEXT: Loading project context for: ${projectId}`);
  
  try {
    // Get project info and message count
    const [project, messageCount, latestFragment] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.message.count({ where: { projectId } }),
      prisma.fragment.findFirst({
        where: { message: { projectId } },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    // Load existing files from latest fragment
    const existingFiles = latestFragment?.files as { [path: string]: string } || {};
    
    // Create file versions tracking
    const fileVersions: { [path: string]: number } = {};
    Object.keys(existingFiles).forEach(path => {
      fileVersions[path] = 1; // Start with version 1, could be enhanced later
    });

    // Determine if this is first run
    const isFirstRun = messageCount === 0;
    
    // Load business info using router intelligence
    const businessInfoStatus = await checkExistingBusinessInfo(projectId);
    
    // Determine project phase
    const projectPhase = await detectProjectPhase(projectId);

    const context: Partial<AgentState> = {
      projectPhase: projectPhase as AgentState['projectPhase'],
      isFirstRun,
      lastUserInput: currentUserInput,
      files: existingFiles,
      fileVersions,
      lastCodeGeneration: latestFragment?.createdAt,
      conversationTurn: messageCount + 1,
      totalMessages: messageCount,
      lastActivity: new Date(),
      executionHistory: [],
      
      // Update business info if found
      ...(businessInfoStatus.isComplete && {
        businessInfo: {
          businessName: businessInfoStatus.businessName || "",
          businessDescription: businessInfoStatus.businessDescription || "",
          businessIndustry: businessInfoStatus.businessIndustry || "",
          businessSubIndustry: businessInfoStatus.businessSubIndustry || "",
          businessAddress: businessInfoStatus.businessAddress || "",
          businessContactInfo: businessInfoStatus.businessContactInfo || "",
        }
      })
    };

    console.log(`✅ CONTEXT: Loaded project context:`, {
      projectPhase: context.projectPhase,
      isFirstRun: context.isFirstRun,
      totalMessages: context.totalMessages,
      hasFiles: Object.keys(context.files || {}).length > 0,
      businessInfoComplete: businessInfoStatus.isComplete
    });

    return context;
    
  } catch (error) {
    console.error(`❌ CONTEXT: Error loading project context:`, error);
    
    // Return minimal context for new projects
    return {
      projectPhase: 'NEW',
      isFirstRun: true,
      lastUserInput: currentUserInput,
      files: {},
      fileVersions: {},
      conversationTurn: 1,
      totalMessages: 0,
      lastActivity: new Date(),
      executionHistory: []
    };
  }
};

/**
 * Analyze user input to determine change request context
 */
const analyzeChangeRequest = (userInput: string): AgentState['changeRequestContext'] | undefined => {
  if (!isChangeRequest(userInput)) {
    return undefined;
  }

  const input = userInput.toLowerCase();
  
  // Determine change type
  let type: AgentState['changeRequestContext']['type'] = 'OTHER';
  
  if (input.includes('color') || input.includes('background') || input.includes('style') || input.includes('theme')) {
    type = 'STYLE';
  } else if (input.includes('text') || input.includes('content') || input.includes('wording')) {
    type = 'CONTENT';
  } else if (input.includes('add') || input.includes('remove') || input.includes('feature')) {
    type = 'FEATURE';
  } else if (input.includes('layout') || input.includes('position') || input.includes('move')) {
    type = 'LAYOUT';
  }

  return {
    type,
    description: userInput,
    targetFiles: [] // Could be enhanced to detect specific files
  };
};

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
  { 
    id: "code-agent",
    concurrency: {
      // Prevent multiple runs for the same project
      key: "event.data.projectId",
      limit: 1
    }
  },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    console.log(`🚀 CODE-AGENT: Starting execution for project ${event.data.projectId}`);
    console.log(`📝 CODE-AGENT: User input: "${event.data.value}"`);
    
    // Set global context for router access
    currentUserInput = event.data.value;
    currentProjectId = event.data.projectId;
    
    // Check if there's already a running agent for this project
    await step.run("check-concurrent-runs", async () => {
      console.log(`🔒 CODE-AGENT: Concurrency control active for project ${event.data.projectId}`);
      return { projectId: event.data.projectId, timestamp: new Date().toISOString() };
    });
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("intuivox-nextjs-test-2");
      await sandbox.setTimeout(SANDBOX_TIMEOUT); // Keep sandbox alive for 30 mins
      return sandbox.sandboxId;
    });

    // Load previous messages only if history is disabled
    // When history is enabled, this will be handled automatically by the history adapter
    const previousMessages = await step.run(
      "get-previous-messages",
      async () => {
        if (ENABLE_HISTORY) {
          console.log("📚 History enabled - previous messages will be loaded by history adapter");
          return [];
        }

        console.log("📚 History disabled - loading messages manually (legacy mode)");
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

    // Phase 3: Load enhanced project context
    console.log("📚 Loading enhanced project context...");
    const projectContext = await loadProjectContext(event.data.projectId);
    const changeContext = analyzeChangeRequest(event.data.value);
    
    // Phase 4: Integrate memory layer (optional)
    console.log("🧠 Integrating memory layer...");
    const { suggestions, enhancedContext } = await integrateMemoryLayer(
      event.data.projectId,
      event.data.value,
      projectContext
    );
    
    if (suggestions.length > 0) {
      console.log("💡 Memory suggestions available:", suggestions);
    }
    
    // Create initial state with enhanced context
    const state = createState<AgentState>(
      {
        // Core project info
        projectId: event.data.projectId,
        sandboxId: sandboxId,
        
        // Business information (from enhanced context or defaults)
        businessInfo: enhancedContext.businessInfo || {
          businessName: "",
          businessDescription: "",
          businessIndustry: "",
          businessSubIndustry: "",
          businessAddress: "",
          businessContactInfo: "",
        },
        
        // Project lifecycle tracking
        projectPhase: enhancedContext.projectPhase || 'NEW',
        isFirstRun: enhancedContext.isFirstRun || true,
        lastUserInput: event.data.value,
        changeRequestContext: changeContext,
        
        // Code and file context
        summary: "",
        files: enhancedContext.files || {},
        fileVersions: enhancedContext.fileVersions || {},
        lastCodeGeneration: enhancedContext.lastCodeGeneration,
        
        // User session context
        conversationTurn: enhancedContext.conversationTurn || 1,
        totalMessages: enhancedContext.totalMessages || 0,
        lastActivity: new Date(),
        
        // Performance tracking
        executionHistory: enhancedContext.executionHistory || []
      },
      {
        messages: previousMessages,
        // When history is enabled, add threadId to state for history adapter
        ...(ENABLE_HISTORY && {
          threadId: event.data.projectId
        })
      }
    );

    console.log("✅ Enhanced state initialized with context:", {
      projectPhase: state.data.projectPhase,
      isFirstRun: state.data.isFirstRun,
      conversationTurn: state.data.conversationTurn,
      hasFiles: Object.keys(state.data.files).length > 0,
      hasBusinessInfo: !!state.data.businessInfo.businessName,
      changeRequestType: changeContext?.type
    });

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

          // Phase 4: Learn from agent responses for memory layer
          if (lastAssistantMessageText && network) {
            learnFromInteraction(
              network.state.data.projectId,
              network.state.data.lastUserInput,
              lastAssistantMessageText
            ).catch(err => console.error('Memory learning error:', err));
          }

          return result;
        },
      },
    });

    // Create network with optional history support
    console.log(`🏗️ Creating network with history ${ENABLE_HISTORY ? 'ENABLED' : 'DISABLED'}`);
    
    const networkConfig = {
      name: "coding-agent-network",
      agents: [codeAgent, businessInfoGathererAgent],
      maxIter: 15,
      defaultState: state,
      router: async ({ network }: { network: { state: { data: AgentState; messages?: Message[] } } }) => {
        const summary = network.state.data.summary;
        if (summary) {
          console.log("🏁 ROUTER: Found summary, stopping network execution");
          return; // Stop the network when we have a summary
        }

        // PHASE 2: Router Intelligence - Get comprehensive project state
        const projectId = network.state.data.projectId;
        const userInput = currentUserInput; // Use global context
        
        console.log("🧠 ROUTER: Using Phase 2 Router Intelligence");
        console.log(`📝 ROUTER: Analyzing user input: "${userInput}"`);
        const projectState = await getProjectState(projectId, userInput);
        
        // Update network state with discovered business info
        if (projectState.businessInfo.isComplete && 
            (!network.state.data.businessInfo.businessName)) {
          console.log("🔄 ROUTER: Updating network state with discovered business info");
          
          network.state.data.businessInfo = {
            businessName: projectState.businessInfo.businessName || "",
            businessDescription: projectState.businessInfo.businessDescription || "",
            businessIndustry: projectState.businessInfo.businessIndustry || "",
            businessSubIndustry: projectState.businessInfo.businessSubIndustry || "",
            businessAddress: projectState.businessInfo.businessAddress || "",
            businessContactInfo: projectState.businessInfo.businessContactInfo || "",
          };
        }

        // Router decision based on project state
        const routingDecision = determineRouting(projectState);
        
        console.log(`🧭 ROUTER: Final decision - Route to: ${routingDecision.agent}`);
        console.log(`📊 ROUTER: Decision reasoning:`, routingDecision.reasoning);

        if (routingDecision.agent === 'business-info-gatherer') {
          console.log("➡️ ROUTER: Routing to business-info-gatherer-agent");
          return businessInfoGathererAgent;
        } else {
          console.log("➡️ ROUTER: Routing to code-agent");
          return codeAgent;
        }
      },
      // Add history adapter if enabled
      ...(ENABLE_HISTORY && {
        history: intuivoxHistoryAdapter
      })
    };

    const network = createNetwork<AgentState>(networkConfig);

    // Run the network with enhanced logging
    console.log(`🚀 CODE-AGENT: Starting network execution for project: ${event.data.projectId}`);
    console.log(`📝 User input: "${event.data.value}"`);
    
    const result = await network.run(event.data.value, { state });
    
    console.log("✅ CODE-AGENT: Network execution completed");
    console.log(`📊 CODE-AGENT: Network result summary:`, {
      final_state_summary: result.state?.data?.summary ? "Present" : "None", 
      business_info_complete: result.state?.data?.businessInfo ? "Collected" : "Missing",
      files_generated: Object.keys(result.state?.data?.files || {}).length,
      history_enabled: ENABLE_HISTORY,
      projectId: event.data.projectId
    });

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
