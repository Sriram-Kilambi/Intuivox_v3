# AgentKit Memory - Implementation Reference for Intuivox

## Overview

Memory in AgentKit enables agents to **recall past interactions, learn user preferences, and maintain context across conversations**. It provides long-term, reflective memory capabilities that persist beyond individual conversation sessions, using Mem0 as the primary memory management system integrated with Inngest for durable operations.

## Core Purpose

Memory addresses several critical needs in AI agent systems:

1. **Contextual Recall** - Remember past interactions and decisions
2. **User Preference Learning** - Adapt to individual user patterns and preferences
3. **Knowledge Accumulation** - Build up domain knowledge over time
4. **Cross-Conversation Context** - Maintain relevant information across multiple sessions
5. **Personalization** - Provide increasingly personalized experiences

## Memory vs. History vs. State

Understanding the distinctions between these concepts:

- **State**: Short-term memory during a single network execution
- **History**: Conversation transcript and message sequence
- **Memory**: Long-term, semantic knowledge and learned insights

```typescript
// State: Current execution context
state.data.currentTask = "generating website";

// History: Conversation messages
history = [
  { role: "user", content: "Create a restaurant website" },
  { role: "assistant", content: "I'll create a restaurant website for you..." }
];

// Memory: Learned insights and preferences
memories = [
  "User prefers modern, minimalist design styles",
  "User's restaurant business focuses on Italian cuisine",
  "User typically wants mobile-first responsive layouts"
];
```

## Memory Integration Patterns

### 1. Mem0 Integration

AgentKit primarily integrates with Mem0 for vector-based memory storage:

```typescript
import { Mem0 } from "@mem0/core";

const mem0Client = new Mem0({
  apiKey: process.env.MEM0_API_KEY
});

// Memory operations through Mem0
const createMemory = async (userId: string, content: string) => {
  return await mem0Client.add({
    user_id: userId,
    messages: [{ role: "user", content }]
  });
};

const retrieveMemories = async (userId: string, query: string) => {
  return await mem0Client.search({
    user_id: userId,
    query,
    limit: 10
  });
};
```

### 2. Memory Tool Patterns

#### Granular, Single-Purpose Tools

Fine-grained control with separate tools for each operation:

```typescript
const createMemoriesTool = createTool({
  name: "create_memories",
  description: "Save one or more new pieces of information to memory",
  parameters: z.object({
    statements: z.array(z.string()).describe("Array of memory statements to save")
  }),
  handler: async ({ statements }, { step, network }) => {
    const userId = network?.state?.data?.userId;
    
    return await step?.run("create-memories", async () => {
      const results = [];
      for (const statement of statements) {
        const memory = await mem0Client.add({
          user_id: userId,
          messages: [{ role: "assistant", content: statement }]
        });
        results.push(memory);
      }
      return {
        created: results.length,
        memories: results
      };
    });
  }
});

const searchMemoriesTool = createTool({
  name: "search_memories", 
  description: "Search for relevant memories based on a query",
  parameters: z.object({
    query: z.string().describe("Search query for finding relevant memories"),
    limit: z.number().default(10).describe("Maximum number of memories to return")
  }),
  handler: async ({ query, limit }, { step, network }) => {
    const userId = network?.state?.data?.userId;
    
    return await step?.run("search-memories", async () => {
      const results = await mem0Client.search({
        user_id: userId,
        query,
        limit
      });
      
      return {
        query,
        found: results.length,
        memories: results.map(r => ({
          content: r.memory,
          relevance: r.score,
          id: r.id
        }))
      };
    });
  }
});

const updateMemoriesTool = createTool({
  name: "update_memories",
  description: "Update existing memories with new information",
  parameters: z.object({
    memoryId: z.string().describe("ID of the memory to update"),
    newContent: z.string().describe("Updated memory content")
  }),
  handler: async ({ memoryId, newContent }, { step, network }) => {
    const userId = network?.state?.data?.userId;
    
    return await step?.run("update-memory", async () => {
      await mem0Client.update({
        memory_id: memoryId,
        data: newContent
      });
      
      return { updated: true, memoryId };
    });
  }
});

const deleteMemoriesTool = createTool({
  name: "delete_memories",
  description: "Remove memories that are no longer relevant",
  parameters: z.object({
    memoryIds: z.array(z.string()).describe("Array of memory IDs to delete")
  }),
  handler: async ({ memoryIds }, { step }) => {
    return await step?.run("delete-memories", async () => {
      const results = [];
      for (const memoryId of memoryIds) {
        await mem0Client.delete({ memory_id: memoryId });
        results.push(memoryId);
      }
      return { deleted: results.length, memoryIds: results };
    });
  }
});
```

#### Consolidated Memory Tool

Simplified approach with a single tool managing multiple operations:

```typescript
const memoryManagerTool = createTool({
  name: "manage_memories",
  description: "Comprehensive memory management tool for create, search, update, and delete operations",
  parameters: z.object({
    operation: z.enum(["create", "search", "update", "delete"]).describe("Memory operation to perform"),
    content: z.string().nullable().describe("Content for create/update operations"),
    query: z.string().nullable().describe("Search query for search operations"),
    memoryId: z.string().nullable().describe("Memory ID for update/delete operations"),
    limit: z.number().default(10).describe("Limit for search results")
  }),
  handler: async ({ operation, content, query, memoryId, limit }, { step, network }) => {
    const userId = network?.state?.data?.userId;
    
    return await step?.run(`memory-${operation}`, async () => {
      switch (operation) {
        case "create":
          if (!content) throw new Error("Content required for create operation");
          const created = await mem0Client.add({
            user_id: userId,
            messages: [{ role: "assistant", content }]
          });
          return { operation: "create", result: created };
          
        case "search":
          if (!query) throw new Error("Query required for search operation");
          const searchResults = await mem0Client.search({
            user_id: userId,
            query,
            limit
          });
          return {
            operation: "search",
            query,
            results: searchResults.map(r => ({
              content: r.memory,
              relevance: r.score,
              id: r.id
            }))
          };
          
        case "update":
          if (!memoryId || !content) throw new Error("Memory ID and content required for update");
          await mem0Client.update({
            memory_id: memoryId,
            data: content
          });
          return { operation: "update", memoryId, updated: true };
          
        case "delete":
          if (!memoryId) throw new Error("Memory ID required for delete operation");
          await mem0Client.delete({ memory_id: memoryId });
          return { operation: "delete", memoryId, deleted: true };
          
        default:
          throw new Error(`Unknown memory operation: ${operation}`);
      }
    });
  }
});
```

## Memory Operation Strategies

### 1. Deterministic Approach

Multi-agent network with structured memory workflow:

```typescript
// Memory retrieval agent
const memoryRetrieverAgent = createAgent({
  name: "memory-retriever",
  description: "Specialized agent for retrieving relevant memories",
  system: `You are a memory retrieval specialist. Your job is to:
    1. Analyze the current user request
    2. Identify what past information would be relevant
    3. Search for and retrieve relevant memories
    4. Summarize found memories for the main assistant`,
  model: openai('gpt-4o-mini'),
  tools: [searchMemoriesTool]
});

// Main assistant agent with memory awareness
const memoryAwareAssistantAgent = createAgent({
  name: "memory-aware-assistant",
  description: "Main assistant that uses retrieved memories to provide personalized responses",
  system: `You are an intelligent assistant with access to user memories and preferences.
    Use the retrieved memories to personalize your responses and recommendations.
    When you learn something new about the user, create appropriate memories.`,
  model: openai('gpt-4o'),
  tools: [createMemoriesTool, updateMemoriesTool]
});

// Memory network with structured workflow
const memoryNetwork = createNetwork({
  name: "memory-enhanced-workflow",
  agents: [memoryRetrieverAgent, memoryAwareAssistantAgent],
  router: ({ network, callCount }) => {
    const state = network.state.data;
    
    // First, retrieve relevant memories
    if (callCount === 0) {
      return memoryRetrieverAgent;
    }
    
    // Then, use main assistant with memory context
    if (callCount === 1) {
      return memoryAwareAssistantAgent;
    }
    
    return null; // Complete
  }
});
```

### 2. Non-Deterministic Approach

Single agent with autonomous memory management:

```typescript
const autonomousMemoryAgent = createAgent({
  name: "autonomous-memory-agent",
  description: "Intelligent agent with autonomous memory management capabilities",
  system: `You are an intelligent assistant with long-term memory capabilities.

    MEMORY MANAGEMENT GUIDELINES:
    1. Always search for relevant memories at the start of conversations
    2. Create new memories when you learn important information about the user
    3. Update existing memories when information changes
    4. Delete outdated or incorrect memories
    5. Use memories to personalize your responses and recommendations
    
    MEMORY CONTENT GUIDELINES:
    - User preferences and patterns
    - Important facts about user's business/projects
    - User's communication style and preferences
    - Technical requirements and constraints
    - Past solutions that worked well
    
    WHEN TO CREATE MEMORIES:
    - User expresses preferences ("I prefer modern designs")
    - User provides business/personal information
    - User mentions constraints or requirements
    - Successful solutions are implemented
    - User feedback indicates satisfaction/dissatisfaction`,
  model: openai('gpt-4o'),
  tools: [memoryManagerTool],
  lifecycle: {
    onStart: async ({ input, network }) => {
      // Automatically search for relevant memories
      const userId = network?.state?.data?.userId;
      if (userId) {
        // This would be handled by the agent's reasoning, but could be automated
        network.state.data.shouldSearchMemories = true;
      }
    }
  }
});
```

## Integration with Intuivox

### Memory-Enhanced Business Info Gatherer

```typescript
const memoryEnhancedBusinessAgent = createAgent<AgentState>({
  name: "memory-enhanced-business-gatherer",
  description: "Business information gatherer with memory of user preferences",
  system: `${BUSINESS_INFO_GATHERER_PROMPT}
  
  MEMORY INTEGRATION:
  - Before asking questions, search for any existing information about this user's business
  - Use past preferences to guide your questions (e.g., if user prefers certain industries)
  - Remember successful interaction patterns with this user
  - Store important business context for future conversations
  - Avoid asking for information you already know from memory
  
  MEMORY PRIORITIES:
  1. Business industry and type preferences
  2. Communication style preferences (formal vs casual)
  3. Geographic location and market focus
  4. Previously successful website styles/approaches
  5. Common pain points or requirements`,
  model: openai({ model: "gpt-4o" }),
  tools: [askUserQuestionTool, memoryManagerTool],
  lifecycle: {
    onStart: async ({ input, network }) => {
      // Search for relevant business memories
      const userId = network?.state?.data?.userId;
      if (userId) {
        network.state.data.shouldLoadMemories = true;
      }
    },
    onResponse: async ({ result, network }) => {
      // Extract and store business information
      const lastMessage = lastAssistantTextMessageContent(result);
      
      if (lastMessage && network) {
        // Store business info in memory as well as state
        if (lastMessage.includes("<business_info>")) {
          const businessInfoMatch = lastMessage.match(
            /<business_info>([\s\S]*?)<\/business_info>/
          );
          
          if (businessInfoMatch) {
            try {
              const parsedBusinessInfo = JSON.parse(businessInfoMatch[1]);
              
              // Update network state
              network.state.data.businessInfo = {
                ...network.state.data.businessInfo,
                ...parsedBusinessInfo
              };
              
              // Create memories for future reference
              network.state.data.shouldCreateBusinessMemories = parsedBusinessInfo;
            } catch (error) {
              console.log("Could not parse business info for memory storage");
            }
          }
        }
      }
      
      return result;
    }
  }
});
```

### Memory-Enhanced Code Agent

```typescript
const memoryEnhancedCodeAgent = createAgent<AgentState>({
  name: "memory-enhanced-code-agent",
  description: "Code generation agent with memory of user preferences and successful patterns",
  system: `${PROMPT}
  
  MEMORY INTEGRATION:
  - Search for user's preferred design styles, frameworks, and patterns
  - Remember successful code solutions for similar businesses
  - Store information about user's technical proficiency level
  - Learn from user feedback on generated code
  - Avoid patterns that didn't work well for this user previously
  
  MEMORY PRIORITIES FOR CODE GENERATION:
  1. Preferred design aesthetics (modern, classic, minimalist, etc.)
  2. Successful color schemes and branding approaches
  3. Technical preferences (React patterns, CSS approaches)
  4. Business-specific requirements (e.g., restaurant needs menu, contact forms)
  5. Performance and accessibility preferences
  6. Integration requirements (payment systems, booking systems)`,
  model: openai({
    model: "gpt-4.1",
    defaultParameters: { temperature: 0.1 }
  }),
  tools: [
    terminalTool,
    createOrUpdateFilesTool,
    readFilesTool,
    memoryManagerTool
  ],
  lifecycle: {
    onStart: async ({ network }) => {
      // Load relevant coding memories
      const businessInfo = network?.state?.data?.businessInfo;
      if (businessInfo?.businessIndustry) {
        network.state.data.shouldLoadCodingMemories = businessInfo.businessIndustry;
      }
    },
    onResponse: async ({ result, network }) => {
      // Store successful code generation patterns
      const lastMessage = lastAssistantTextMessageContent(result);
      
      if (lastMessage && network) {
        if (lastMessage.includes("<task_summary>")) {
          // Store successful implementation details
          network.state.data.shouldCreateCodingMemories = {
            summary: lastMessage,
            businessType: network.state.data.businessInfo?.businessIndustry,
            filesGenerated: Object.keys(network.state.data.files || {}).length
          };
        }
      }
      
      return result;
    }
  }
});
```

### Memory Integration in Network Router

```typescript
const memoryAwareRouter = async ({ network }) => {
  const state = network.state.data;
  const userId = state.userId;
  
  // Handle memory operations triggered by agents
  if (state.shouldLoadMemories && userId) {
    // Search for relevant business memories
    const businessMemories = await mem0Client.search({
      user_id: userId,
      query: "business information preferences industry",
      limit: 5
    });
    
    state.retrievedMemories = businessMemories;
    state.shouldLoadMemories = false;
  }
  
  if (state.shouldCreateBusinessMemories) {
    // Create memories from collected business info
    const businessInfo = state.shouldCreateBusinessMemories;
    const memories = [
      `User's business: ${businessInfo.businessName} in ${businessInfo.businessIndustry}`,
      `Business description: ${businessInfo.businessDescription}`,
      `Business location: ${businessInfo.businessAddress}`,
      `Contact preference: ${businessInfo.businessContactInfo}`
    ];
    
    for (const memory of memories) {
      await mem0Client.add({
        user_id: userId,
        messages: [{ role: "assistant", content: memory }]
      });
    }
    
    state.shouldCreateBusinessMemories = null;
  }
  
  if (state.shouldLoadCodingMemories && userId) {
    // Load coding preferences and patterns
    const codingMemories = await mem0Client.search({
      user_id: userId,
      query: `${state.shouldLoadCodingMemories} website design coding preferences`,
      limit: 5
    });
    
    state.codingMemories = codingMemories;
    state.shouldLoadCodingMemories = null;
  }
  
  if (state.shouldCreateCodingMemories) {
    // Store successful coding patterns
    const codingInfo = state.shouldCreateCodingMemories;
    const memories = [
      `Successful website generated for ${codingInfo.businessType} business`,
      `Generated ${codingInfo.filesGenerated} files with positive outcome`,
      `Implementation approach: ${codingInfo.summary.substring(0, 200)}...`
    ];
    
    for (const memory of memories) {
      await mem0Client.add({
        user_id: userId,
        messages: [{ role: "assistant", content: memory }]
      });
    }
    
    state.shouldCreateCodingMemories = null;
  }
  
  // Continue with normal routing logic
  const summary = state.summary;
  if (summary) return null;
  
  const businessInfo = state.businessInfo;
  const isBusinessInfoComplete = 
    businessInfo.businessName &&
    businessInfo.businessDescription &&
    businessInfo.businessIndustry &&
    businessInfo.businessSubIndustry &&
    businessInfo.businessAddress &&
    businessInfo.businessContactInfo;
  
  if (!isBusinessInfoComplete) {
    return memoryEnhancedBusinessAgent;
  }
  
  return memoryEnhancedCodeAgent;
};
```

## Advanced Memory Patterns

### Contextual Memory Retrieval

```typescript
const contextualMemoryRetrieval = async (
  userId: string, 
  currentContext: string,
  businessType?: string
) => {
  // Build context-aware search queries
  const searchQueries = [
    `${currentContext} preferences`,
    `${businessType} successful patterns`,
    `user communication style`,
    `technical requirements constraints`
  ];
  
  const allMemories = [];
  
  for (const query of searchQueries) {
    const memories = await mem0Client.search({
      user_id: userId,
      query,
      limit: 3
    });
    allMemories.push(...memories);
  }
  
  // Deduplicate and score by relevance
  const uniqueMemories = allMemories.reduce((unique, memory) => {
    if (!unique.find(m => m.id === memory.id)) {
      unique.push(memory);
    }
    return unique;
  }, []);
  
  // Sort by relevance and recency
  return uniqueMemories
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);
};
```

### Memory-Driven Personalization

```typescript
const personalizedResponseGeneration = async (
  userId: string,
  baseResponse: string,
  context: string
) => {
  // Retrieve personalization memories
  const personalMemories = await mem0Client.search({
    user_id: userId,
    query: "communication style preferences tone",
    limit: 5
  });
  
  // Extract personalization insights
  const personalizations = personalMemories.map(m => m.memory).join("\n");
  
  // Use AI to personalize response
  const personalizationAgent = createAgent({
    name: "personalizer",
    system: `Personalize the following response based on user memories:
      
      User memories: ${personalizations}
      
      Adjust tone, style, and content to match user preferences while maintaining accuracy.`,
    model: openai('gpt-4o-mini')
  });
  
  const result = await personalizationAgent.run(
    `Base response: ${baseResponse}\n\nContext: ${context}`
  );
  
  return result.output[0]?.content || baseResponse;
};
```

### Memory-Based Learning Loop

```typescript
const memoryLearningLoop = async (
  userId: string,
  interaction: {
    userInput: string;
    agentResponse: string;
    userFeedback?: string;
    successful: boolean;
  }
) => {
  if (interaction.successful) {
    // Store successful interaction patterns
    await mem0Client.add({
      user_id: userId,
      messages: [{
        role: "assistant",
        content: `Successful interaction: User asked "${interaction.userInput}" and was satisfied with approach involving ${interaction.agentResponse.substring(0, 100)}...`
      }]
    });
  } else {
    // Store what didn't work
    await mem0Client.add({
      user_id: userId,
      messages: [{
        role: "assistant", 
        content: `Unsuccessful approach: User asked "${interaction.userInput}" but was not satisfied. Avoid similar approaches in the future.`
      }]
    });
  }
  
  // If explicit feedback provided
  if (interaction.userFeedback) {
    await mem0Client.add({
      user_id: userId,
      messages: [{
        role: "assistant",
        content: `User feedback: "${interaction.userFeedback}" regarding request "${interaction.userInput}"`
      }]
    });
  }
};
```

## Performance and Optimization

### Memory Caching Strategy

```typescript
const memoryCache = new Map<string, { memories: any[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getCachedMemories = async (userId: string, query: string) => {
  const cacheKey = `${userId}:${query}`;
  const cached = memoryCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.memories;
  }
  
  const memories = await mem0Client.search({
    user_id: userId,
    query,
    limit: 10
  });
  
  memoryCache.set(cacheKey, {
    memories,
    timestamp: Date.now()
  });
  
  return memories;
};
```

### Async Memory Operations

```typescript
const asyncMemoryTool = createTool({
  name: "async_memory_operations",
  description: "Perform memory operations asynchronously to avoid blocking",
  parameters: z.object({
    operations: z.array(z.object({
      type: z.enum(["create", "search", "update", "delete"]),
      data: z.unknown()
    }))
  }),
  handler: async ({ operations }, { step }) => {
    // Queue memory operations for background processing
    await step?.sendEvent("memory-operations-event", {
      name: "app/memory-operations",
      data: { operations }
    });
    
    return {
      queued: operations.length,
      message: "Memory operations queued for background processing"
    };
  }
});

// Background memory processing function
export const processMemoryOperations = inngest.createFunction(
  { id: "process-memory-operations" },
  { event: "app/memory-operations" },
  async ({ event, step }) => {
    const operations = event.data.operations;
    
    for (const [index, operation] of operations.entries()) {
      await step.run(`memory-op-${index}`, async () => {
        switch (operation.type) {
          case "create":
            return await mem0Client.add(operation.data);
          case "search":
            return await mem0Client.search(operation.data);
          case "update":
            return await mem0Client.update(operation.data);
          case "delete":
            return await mem0Client.delete(operation.data);
        }
      });
    }
    
    return { processed: operations.length };
  }
);
```

## Best Practices for Intuivox

### 1. Memory Categorization

```typescript
const categorizedMemoryCreation = async (
  userId: string,
  content: string,
  category: 'business' | 'preferences' | 'technical' | 'feedback'
) => {
  const categorizedContent = `[${category.toUpperCase()}] ${content}`;
  
  return await mem0Client.add({
    user_id: userId,
    messages: [{ role: "assistant", content: categorizedContent }],
    metadata: {
      category,
      timestamp: Date.now(),
      source: 'intuivox-agent'
    }
  });
};
```

### 2. Memory Lifecycle Management

```typescript
const memoryLifecycleManager = {
  async createProjectMemory(userId: string, projectId: string, businessInfo: any) {
    const memories = [
      `Project ${projectId}: Business type - ${businessInfo.businessIndustry}`,
      `Project ${projectId}: Business name - ${businessInfo.businessName}`,
      `Project ${projectId}: Requirements - ${businessInfo.businessDescription}`
    ];
    
    for (const memory of memories) {
      await mem0Client.add({
        user_id: userId,
        messages: [{ role: "assistant", content: memory }],
        metadata: { projectId, type: 'project_context' }
      });
    }
  },

  async updateSuccessPatterns(userId: string, projectId: string, outcome: string) {
    await mem0Client.add({
      user_id: userId,
      messages: [{
        role: "assistant",
        content: `Project ${projectId} outcome: ${outcome}. This approach was successful.`
      }],
      metadata: { projectId, type: 'success_pattern' }
    });
  },

  async cleanupOldMemories(userId: string, maxAge: number = 30 * 24 * 60 * 60 * 1000) {
    const oldMemories = await mem0Client.search({
      user_id: userId,
      query: "",
      limit: 100
    });
    
    const cutoffTime = Date.now() - maxAge;
    
    for (const memory of oldMemories) {
      if (memory.created_at && new Date(memory.created_at).getTime() < cutoffTime) {
        await mem0Client.delete({ memory_id: memory.id });
      }
    }
  }
};
```

### 3. Privacy and Security

```typescript
const secureMemoryOperations = {
  async sanitizeMemoryContent(content: string): Promise<string> {
    // Remove sensitive information before storing
    return content
      .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD_REDACTED]')
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN_REDACTED]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]');
  },

  async createSecureMemory(userId: string, content: string, category: string) {
    const sanitizedContent = await this.sanitizeMemoryContent(content);
    
    return await mem0Client.add({
      user_id: userId,
      messages: [{ role: "assistant", content: `[${category}] ${sanitizedContent}` }],
      metadata: {
        category,
        sanitized: true,
        created_at: new Date().toISOString()
      }
    });
  }
};
```

This comprehensive Memory reference provides everything needed to implement long-term memory capabilities in Intuivox, enabling your agents to learn from user interactions, remember preferences, and provide increasingly personalized website generation experiences.