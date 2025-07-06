import { MemoryClient, Memory, Message, SearchOptions } from "mem0ai";

interface MemoryEntry {
  id: string;
  memory: string;
  score?: number;
  metadata?: Record<string, any>;
}

interface BusinessInfoMemory {
  businessName: string;
  businessDescription: string;
  businessIndustry: string;
  businessSubIndustry: string;
  businessAddress: string;
  businessContactInfo: string;
  isComplete: boolean;
}

interface ConversationContext {
  hasBusinessInfo: boolean;
  userIntent: "new_website" | "incremental_change" | "question" | "unknown";
  relevantContext: string[];
  shouldSkipBusinessGathering: boolean;
  previousFragments: number;
}

class Mem0Service {
  private client: MemoryClient;

  constructor() {
    const apiKey = process.env.MEM0_API_KEY;
    if (!apiKey) {
      throw new Error("MEM0_API_KEY environment variable is required");
    }
    this.client = new MemoryClient({ apiKey });
  }

  /**
   * Store a memory for a user using messages format
   */
  async storeMemory(
    text: string,
    userId: string,
    metadata?: Record<string, any>
  ): Promise<Memory[]> {
    try {
      console.log(
        `Storing memory for user ${userId}: ${text.substring(0, 100)}...`
      );

      // Format as messages array with proper typing
      const messages: Message[] = [{ role: "user", content: text }];

      const response = await this.client.add(messages, {
        user_id: userId,
        metadata: {
          timestamp: new Date().toISOString(),
          ...metadata,
        },
      });

      console.log("Memory stored successfully");
      return response;
    } catch (error) {
      console.error("Error storing memory:", error);
      throw error;
    }
  }

  /**
   * Search for relevant memories for a user
   */
  async searchMemories(
    query: string,
    userId: string,
    limit: number = 5
  ): Promise<MemoryEntry[]> {
    try {
      console.log(`Searching memories for user ${userId}: ${query}`);

      const response = await this.client.search(query, {
        user_id: userId,
        limit,
      });

      console.log(`Found ${response.length || 0} memories`);

      // Convert Memory[] to MemoryEntry[]
      return response.map((memory: Memory) => ({
        id: memory.id,
        memory: memory.memory || "",
        score: memory.score || 0,
        metadata: memory.metadata || {},
      }));
    } catch (error) {
      console.error("Error searching memories:", error);
      return [];
    }
  }

  /**
   * Get all memories for a user
   */
  async getUserMemories(userId: string): Promise<MemoryEntry[]> {
    try {
      console.log(`Getting all memories for user ${userId}`);

      const response = await this.client.getAll({
        user_id: userId,
      });

      // Convert Memory[] to MemoryEntry[]
      return response.map((memory: Memory) => ({
        id: memory.id,
        memory: memory.memory || "",
        score: memory.score || 0,
        metadata: memory.metadata || {},
      }));
    } catch (error) {
      console.error("Error getting user memories:", error);
      return [];
    }
  }

  /**
   * Store business information completion
   */
  async storeBusinessInfoCompletion(
    userId: string,
    projectId: string,
    businessInfo: BusinessInfoMemory
  ): Promise<void> {
    try {
      const memoryText = `Business information collected for project ${projectId}: 
        Business Name: ${businessInfo.businessName}
        Description: ${businessInfo.businessDescription}
        Industry: ${businessInfo.businessIndustry}
        Sub-industry: ${businessInfo.businessSubIndustry}
        Address: ${businessInfo.businessAddress}
        Contact: ${businessInfo.businessContactInfo}
        Status: Complete`;

      await this.storeMemory(memoryText, userId, {
        type: "business_info",
        projectId,
        isComplete: true,
        businessName: businessInfo.businessName,
        businessIndustry: businessInfo.businessIndustry,
      });
    } catch (error) {
      console.error("Error storing business info completion:", error);
      throw error;
    }
  }

  /**
   * Check if business info has been collected for a project
   */
  async hasBusinessInfoBeenCollected(
    userId: string,
    projectId: string
  ): Promise<boolean> {
    try {
      const memories = await this.searchMemories(
        `business information project ${projectId}`,
        userId,
        3
      );

      return memories.some(
        (memory) =>
          memory.metadata?.type === "business_info" &&
          memory.metadata?.projectId === projectId &&
          memory.metadata?.isComplete === true
      );
    } catch (error) {
      console.error("Error checking business info:", error);
      return false;
    }
  }

  /**
   * Get conversation context to understand user intent
   */
  async getConversationContext(
    userId: string,
    projectId: string,
    currentMessage: string,
    previousFragments: number = 0
  ): Promise<ConversationContext> {
    try {
      console.log(
        `Getting conversation context for user ${userId}, project ${projectId}`
      );

      // Search for relevant memories about this project
      const projectMemories = await this.searchMemories(
        `project ${projectId} business information website`,
        userId,
        5
      );

      // Search for general user patterns
      const userPatterns = await this.searchMemories(currentMessage, userId, 3);

      // Check if business info exists
      const hasBusinessInfo = await this.hasBusinessInfoBeenCollected(
        userId,
        projectId
      );

      // Analyze user intent based on message content and context
      let userIntent: ConversationContext["userIntent"] = "unknown";
      const lowerMessage = currentMessage.toLowerCase();

      if (
        lowerMessage.includes("change") ||
        lowerMessage.includes("update") ||
        lowerMessage.includes("modify") ||
        lowerMessage.includes("improve") ||
        lowerMessage.includes("add") ||
        lowerMessage.includes("remove")
      ) {
        userIntent = "incremental_change";
      } else if (
        lowerMessage.includes("create") ||
        lowerMessage.includes("build") ||
        lowerMessage.includes("new") ||
        lowerMessage.includes("start")
      ) {
        userIntent = "new_website";
      } else if (
        lowerMessage.includes("what") ||
        lowerMessage.includes("how") ||
        lowerMessage.includes("why") ||
        lowerMessage.includes("?")
      ) {
        userIntent = "question";
      }

      // If user has business info and previous fragments, and intent suggests incremental change
      const shouldSkipBusinessGathering =
        hasBusinessInfo &&
        previousFragments > 0 &&
        (userIntent === "incremental_change" || userIntent === "question");

      const relevantContext = [
        ...projectMemories.map((m) => m.memory),
        ...userPatterns.map((m) => m.memory),
      ];

      const context: ConversationContext = {
        hasBusinessInfo,
        userIntent,
        relevantContext,
        shouldSkipBusinessGathering,
        previousFragments,
      };

      console.log("Conversation context:", {
        hasBusinessInfo,
        userIntent,
        shouldSkipBusinessGathering,
        contextCount: relevantContext.length,
      });

      return context;
    } catch (error) {
      console.error("Error getting conversation context:", error);
      return {
        hasBusinessInfo: false,
        userIntent: "unknown",
        relevantContext: [],
        shouldSkipBusinessGathering: false,
        previousFragments,
      };
    }
  }

  /**
   * Store user preference
   */
  async storeUserPreference(
    userId: string,
    preference: string,
    category?: string
  ): Promise<void> {
    try {
      await this.storeMemory(`User preference: ${preference}`, userId, {
        type: "user_preference",
        category: category || "general",
      });
    } catch (error) {
      console.error("Error storing user preference:", error);
      throw error;
    }
  }

  /**
   * Store conversation context
   */
  async storeConversationContext(
    userId: string,
    projectId: string,
    context: string,
    contextType: string
  ): Promise<void> {
    try {
      await this.storeMemory(`Project ${projectId}: ${context}`, userId, {
        type: "conversation_context",
        projectId,
        contextType,
      });
    } catch (error) {
      console.error("Error storing conversation context:", error);
      throw error;
    }
  }

  /**
   * Store successful code generation patterns
   */
  async storeCodePattern(
    userId: string,
    projectId: string,
    pattern: string,
    success: boolean
  ): Promise<void> {
    try {
      await this.storeMemory(
        `Code generation pattern for project ${projectId}: ${pattern}`,
        userId,
        {
          type: "code_pattern",
          projectId,
          success,
        }
      );
    } catch (error) {
      console.error("Error storing code pattern:", error);
      throw error;
    }
  }
}

// Export a singleton instance
export const mem0Service = new Mem0Service();
