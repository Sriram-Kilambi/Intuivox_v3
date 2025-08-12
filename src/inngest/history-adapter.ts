import { HistoryConfig, AgentResult } from "@inngest/agent-kit";
import { prisma } from "@/lib/db";
import { MessageRole, MessageType } from "@/generated/prisma";
import { lastAssistantTextMessageContent } from "./utils";

/**
 * AgentState interface from functions.ts
 * TODO: Move this to a shared types file
 */
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
}

/**
 * Enhanced validation for Message to AgentResult conversion
 */
const validateMessageForConversion = (message: any): boolean => {
  if (!message) {
    console.error("❌ Message is null or undefined");
    return false;
  }
  
  if (!message.content || typeof message.content !== 'string') {
    console.error("❌ Message missing valid content:", message.id);
    return false;
  }
  
  if (!message.role || !['USER', 'ASSISTANT'].includes(message.role)) {
    console.error("❌ Message has invalid role:", message.role, "for message:", message.id);
    return false;
  }
  
  return true;
};

/**
 * Enhanced convert Prisma Message to AgentResult format
 */
export const convertMessageToAgentResult = (message: any): AgentResult => {
  // Validate input message
  if (!validateMessageForConversion(message)) {
    throw new Error(`Invalid message data for conversion: ${message?.id || 'unknown'}`);
  }

  console.log(`🔄 Converting message ${message.id} (${message.type}) to AgentResult`);

  // Create output message
  const output = [{
    type: "text" as const,
    role: message.role === "USER" ? "user" as const : "assistant" as const,
    content: message.content
  }];

  // Handle tool calls for messages with fragments
  let toolCalls = [];
  if (message.fragment) {
    console.log(`🔧 Message has fragment, creating tool call`);
    
    const toolCall = {
      toolName: determineToolNameFromFragment(message.fragment),
      parameters: createToolParametersFromFragment(message.fragment),
      result: createToolResultFromFragment(message.fragment)
    };
    
    toolCalls.push(toolCall);
  }

  const agentResult: AgentResult = {
    output,
    agentName: message.role === "USER" ? "user" : getAgentNameFromMessageType(message.type),
    toolCalls,
    timestamp: message.createdAt.toISOString(),
    // Store original message metadata for debugging and traceability
    metadata: {
      messageId: message.id,
      messageType: message.type,
      hasFragment: !!message.fragment,
      originalRole: message.role
    }
  };

  console.log(`✅ Successfully converted message ${message.id} to AgentResult`);
  return agentResult;
};

/**
 * Determine tool name from fragment data
 */
const determineToolNameFromFragment = (fragment: any): string => {
  if (fragment.files && Object.keys(fragment.files).length > 0) {
    return "createOrUpdateFiles";
  }
  if (fragment.sandboxUrl) {
    return "terminal";
  }
  return "unknown_tool";
};

/**
 * Create tool parameters from fragment
 */
const createToolParametersFromFragment = (fragment: any): any => {
  const params: any = {};
  
  if (fragment.files && Object.keys(fragment.files).length > 0) {
    // Convert files object to array format expected by createOrUpdateFiles tool
    const filesArray = Object.entries(fragment.files).map(([path, content]) => ({
      path,
      content: content as string
    }));
    params.files = filesArray;
  }
  
  if (fragment.title) {
    params.title = fragment.title;
  }
  
  return params;
};

/**
 * Create tool result from fragment
 */
const createToolResultFromFragment = (fragment: any): any => {
  return {
    sandboxUrl: fragment.sandboxUrl || "",
    title: fragment.title || "Generated Code",
    files: fragment.files || {},
    fragmentId: fragment.id,
    createdAt: fragment.createdAt
  };
};

/**
 * Enhanced validation for AgentResult to Message conversion
 */
const validateAgentResultForConversion = (result: AgentResult): boolean => {
  if (!result) {
    console.error("❌ AgentResult is null or undefined");
    return false;
  }
  
  if (!result.output || !Array.isArray(result.output) || result.output.length === 0) {
    console.error("❌ AgentResult missing valid output array");
    return false;
  }
  
  const firstOutput = result.output[0];
  if (!firstOutput || firstOutput.type !== "text") {
    console.error("❌ AgentResult first output is not text type");
    return false;
  }
  
  if (typeof firstOutput.content !== 'string') {
    console.error("❌ AgentResult text content is not a string");
    return false;
  }
  
  return true;
};

/**
 * Enhanced convert AgentResult to Prisma Message format
 */
export const convertAgentResultToMessage = (
  result: AgentResult, 
  projectId: string,
  messageType?: MessageType
) => {
  // Validate input
  if (!validateAgentResultForConversion(result)) {
    throw new Error("Invalid AgentResult for conversion to Message");
  }
  
  if (!projectId) {
    throw new Error("ProjectId is required for message conversion");
  }

  console.log(`🔄 Converting AgentResult from ${result.agentName} to Message`);

  const output = result.output[0];
  
  // Determine message role
  const role: MessageRole = output.role === "user" ? "USER" : "ASSISTANT";
  
  // Determine message type if not provided
  let finalMessageType: MessageType = messageType || determineMessageTypeFromResult(result);
  
  // Extract fragment data from tool calls
  const fragmentData = extractFragmentDataFromToolCalls(result.toolCalls);
  
  if (fragmentData) {
    console.log(`🔧 Creating fragment data for message`);
  }

  const messageData = {
    content: output.content,
    role,
    type: finalMessageType,
    projectId,
    ...(fragmentData && {
      fragment: {
        create: fragmentData
      }
    })
  };

  console.log(`✅ Successfully converted AgentResult to Message format`);
  return messageData;
};

/**
 * Determine message type from AgentResult
 */
const determineMessageTypeFromResult = (result: AgentResult): MessageType => {
  // Check for error in result
  if (result.error) {
    return "ERROR";
  }
  
  // Check if this looks like a question (contains question mark and is from business agent)
  const content = result.output[0]?.content || "";
  if (content.includes("?") && result.agentName === "business-info-gatherer-agent") {
    return "AGENT_QUESTION";
  }
  
  // Default to RESULT
  return "RESULT";
};

/**
 * Enhanced extract fragment data from tool calls
 */
const extractFragmentDataFromToolCalls = (toolCalls?: any[]) => {
  if (!toolCalls || toolCalls.length === 0) {
    console.log("🔍 No tool calls found, no fragment data to extract");
    return null;
  }

  console.log(`🔍 Checking ${toolCalls.length} tool calls for fragment data`);

  // Look for file-related tool calls
  const fileToolCall = toolCalls.find(call => 
    call.toolName === "createOrUpdateFiles" || 
    call.toolName === "readFiles" ||
    call.toolName === "terminal" // Terminal calls might also create fragments
  );

  if (!fileToolCall) {
    console.log("🔍 No file-related tool calls found");
    return null;
  }

  console.log(`🔧 Found ${fileToolCall.toolName} tool call, extracting fragment data`);

  // Extract files from parameters or result
  let files = {};
  
  if (fileToolCall.result?.files) {
    files = fileToolCall.result.files;
  } else if (fileToolCall.parameters?.files) {
    // Convert array format to object format if needed
    if (Array.isArray(fileToolCall.parameters.files)) {
      files = fileToolCall.parameters.files.reduce((acc, file) => {
        if (file.path && file.content) {
          acc[file.path] = file.content;
        }
        return acc;
      }, {});
    } else {
      files = fileToolCall.parameters.files;
    }
  }

  // Only create fragment if we have files
  if (!files || Object.keys(files).length === 0) {
    console.log("🔍 No files found in tool call, skipping fragment creation");
    return null;
  }

  const fragmentData = {
    sandboxUrl: fileToolCall.result?.sandboxUrl || "",
    title: fileToolCall.result?.title || extractTitleFromToolCall(fileToolCall),
    files: files
  };

  console.log(`✅ Extracted fragment data with ${Object.keys(files).length} files`);
  return fragmentData;
};

/**
 * Extract meaningful title from tool call
 */
const extractTitleFromToolCall = (toolCall: any): string => {
  if (toolCall.toolName === "createOrUpdateFiles") {
    const fileCount = toolCall.parameters?.files ? 
      (Array.isArray(toolCall.parameters.files) ? 
        toolCall.parameters.files.length : 
        Object.keys(toolCall.parameters.files).length) : 0;
    return `Generated ${fileCount} Files`;
  }
  
  if (toolCall.toolName === "terminal") {
    return "Terminal Output";
  }
  
  return "Generated Code";
};

/**
 * Get agent name from message type
 */
const getAgentNameFromMessageType = (type: MessageType): string => {
  switch (type) {
    case "AGENT_QUESTION":
      return "business-info-gatherer-agent";
    case "RESULT":
      return "code-agent";
    case "ERROR":
      return "system";
    default:
      return "unknown";
  }
};

/**
 * Batch convert messages to AgentResults with error handling
 */
export const convertMessagesToAgentResults = (messages: any[]): AgentResult[] => {
  console.log(`🔄 Batch converting ${messages.length} messages to AgentResults`);
  
  const results: AgentResult[] = [];
  const errors: string[] = [];
  
  for (const [index, message] of messages.entries()) {
    try {
      const agentResult = convertMessageToAgentResult(message);
      results.push(agentResult);
    } catch (error) {
      console.error(`❌ Failed to convert message ${index + 1}/${messages.length}:`, error);
      errors.push(`Message ${message?.id || 'unknown'}: ${error.message}`);
      
      // Create a fallback result for failed conversions
      const fallbackResult: AgentResult = {
        output: [{
          type: "text" as const,
          role: "assistant" as const,
          content: `[Error loading message: ${error.message}]`
        }],
        agentName: "system",
        toolCalls: [],
        timestamp: message?.createdAt?.toISOString() || new Date().toISOString(),
        error: error.message,
        metadata: {
          messageId: message?.id || 'unknown',
          conversionError: true
        }
      };
      
      results.push(fallbackResult);
    }
  }
  
  if (errors.length > 0) {
    console.warn(`⚠️ ${errors.length} conversion errors occurred:`, errors);
  }
  
  console.log(`✅ Batch conversion complete: ${results.length} results (${errors.length} errors)`);
  return results;
};

/**
 * Batch convert AgentResults to Messages with error handling
 */
export const convertAgentResultsToMessages = (
  results: AgentResult[], 
  projectId: string
): any[] => {
  console.log(`🔄 Batch converting ${results.length} AgentResults to Messages`);
  
  const messages: any[] = [];
  const errors: string[] = [];
  
  for (const [index, result] of results.entries()) {
    try {
      const messageData = convertAgentResultToMessage(result, projectId);
      messages.push(messageData);
    } catch (error) {
      console.error(`❌ Failed to convert result ${index + 1}/${results.length}:`, error);
      errors.push(`Result from ${result?.agentName || 'unknown'}: ${error.message}`);
      
      // Skip failed conversions rather than creating invalid data
      // The error is logged for debugging
    }
  }
  
  if (errors.length > 0) {
    console.warn(`⚠️ ${errors.length} conversion errors occurred:`, errors);
  }
  
  console.log(`✅ Batch conversion complete: ${messages.length} messages (${errors.length} errors)`);
  return messages;
};

/**
 * Intuivox History Adapter implementation
 * Uses existing Prisma Project and Message models
 */
export const intuivoxHistoryAdapter: HistoryConfig<AgentState> = {
  /**
   * Create a new conversation thread
   * In Intuivox, we use the existing Project as the thread
   */
  createThread: async ({ state, input }) => {
    console.log("🏗️ HISTORY ADAPTER: Creating new conversation thread for project:", state.data.projectId);
    console.log("🏗️ HISTORY ADAPTER: Input:", input);
    
    // The project should already exist, but let's verify
    const project = await prisma.project.findUnique({
      where: { id: state.data.projectId }
    });

    if (!project) {
      console.error("❌ HISTORY ADAPTER: Project not found:", state.data.projectId);
      throw new Error(`Project ${state.data.projectId} not found`);
    }

    console.log("✅ HISTORY ADAPTER: Project found, returning threadId:", project.id);
    // Return the project ID as thread ID
    return { threadId: project.id };
  },

  /**
   * Retrieve conversation history from database
   * Load all messages for the project and convert to AgentResult format
   */
  get: async ({ threadId }) => {
    console.log("📚 HISTORY ADAPTER: Loading conversation history for thread:", threadId);
    
    try {
      // Load all messages for this project, including fragments
      const messages = await prisma.message.findMany({
        where: { projectId: threadId },
        include: { fragment: true },
        orderBy: { createdAt: "asc" } // Chronological order
      });

      console.log(`📝 HISTORY ADAPTER: Found ${messages.length} messages in conversation history`);

      if (messages.length === 0) {
        console.log("📭 HISTORY ADAPTER: No messages found, returning empty history");
        return [];
      }

      // Log first few messages for debugging
      console.log("🔍 HISTORY ADAPTER: Sample messages:");
      for (const [i, msg] of messages.slice(0, 3).entries()) {
        console.log(`  ${i + 1}. ${msg.role} ${msg.type}: ${msg.content.slice(0, 50)}...`);
      }

      // Use enhanced batch conversion with error handling
      const agentResults = convertMessagesToAgentResults(messages);

      console.log(`✅ HISTORY ADAPTER: Successfully loaded and converted ${agentResults.length} conversation history items`);
      return agentResults;
      
    } catch (error) {
      console.error("❌ HISTORY ADAPTER: Error loading conversation history:", error);
      
      // Return empty history rather than failing
      console.log("🔄 HISTORY ADAPTER: Returning empty history due to error");
      return [];
    }
  },

  /**
   * Save new agent results to database
   * Convert AgentResult format back to Prisma Message format
   */
  appendResults: async ({ threadId, results }) => {
    console.log(`💾 HISTORY ADAPTER: Saving ${results.length} new results to thread:`, threadId);
    
    if (results.length === 0) {
      console.log("📭 HISTORY ADAPTER: No results to save");
      return;
    }
    
    try {
      // Use batch conversion to prepare all messages
      const messageDataArray = convertAgentResultsToMessages(results, threadId);
      
      if (messageDataArray.length === 0) {
        console.log("⚠️ HISTORY ADAPTER: No valid messages to save after conversion");
        return;
      }

      // Save all messages to database
      console.log(`💾 HISTORY ADAPTER: Saving ${messageDataArray.length} messages to database`);
      
      for (const [index, messageData] of messageDataArray.entries()) {
        try {
          await prisma.message.create({
            data: messageData
          });
          
          console.log(`✅ HISTORY ADAPTER: Saved message ${index + 1}/${messageDataArray.length}`);
          
        } catch (error) {
          console.error(`❌ HISTORY ADAPTER: Error saving message ${index + 1}:`, error);
          console.error("📄 HISTORY ADAPTER: Message data:", JSON.stringify(messageData, null, 2));
          
          // Continue with other messages rather than failing completely
        }
      }
      
      console.log("✅ HISTORY ADAPTER: Finished saving all results to database");
      
    } catch (error) {
      console.error("❌ HISTORY ADAPTER: Error in appendResults:", error);
      // Don't throw error to prevent breaking the agent workflow
      // The error is logged for debugging purposes
    }
  }
};

export default intuivoxHistoryAdapter;