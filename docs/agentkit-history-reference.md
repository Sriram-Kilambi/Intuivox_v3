# AgentKit History - Implementation Reference for Intuivox

## Overview

History in AgentKit enables **persistent conversations that maintain context across multiple runs**. It connects agents and networks to any database or storage solution, allowing conversations to resume exactly where they left off by implementing a History Adapter that bridges execution lifecycle with your database.

## Core Purpose

History solves the fundamental problem of state persistence in multi-agent workflows:

1. **Persistent Conversations** - Maintain context across multiple network executions
2. **Resume Capability** - Continue conversations from exactly where they stopped
3. **Database Integration** - Connect to any storage solution (PostgreSQL, MongoDB, Redis, etc.)
4. **Cross-Session Context** - Preserve conversation state between user sessions

## History Adapter Interface

The `HistoryConfig` interface provides three optional methods that form the bridge between AgentKit and your database:

### Method Overview

```typescript
interface HistoryConfig<TState = any> {
  createThread?: (params: CreateThreadParams<TState>) => Promise<{ threadId: string }>;
  get?: (params: GetHistoryParams<TState>) => Promise<AgentResult[]>;
  appendResults?: (params: AppendResultsParams<TState>) => Promise<void>;
}
```

### 1. createThread Method

**Purpose**: Creates a new conversation thread when no `threadId` exists in the state.

```typescript
createThread: async ({ state, input, network }) => {
  // Create new thread in your database
  const thread = await db.thread.create({
    data: {
      userId: state.data.userId,
      title: input.slice(0, 50),
      projectId: state.data.projectId,
      createdAt: new Date(),
      metadata: {
        networkName: network.name,
        initialPrompt: input
      }
    }
  });
  
  return { threadId: thread.id };
}
```

**Parameters**:
- `state`: Current network state
- `input`: User's initial prompt
- `network`: Network instance

**Returns**: Object with `threadId` property

### 2. get Method

**Purpose**: Retrieves conversation history from your database after thread initialization.

```typescript
get: async ({ threadId, state, network }) => {
  // Fetch conversation history from database
  const messages = await db.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
    include: { toolCalls: true }
  });
  
  // Convert to AgentResult format
  return messages.map(msg => ({
    output: [{
      type: 'text',
      role: msg.role,
      content: msg.content
    }],
    agentName: msg.agentName,
    toolCalls: msg.toolCalls,
    timestamp: msg.createdAt.toISOString()
  }));
}
```

**Parameters**:
- `threadId`: Thread identifier
- `state`: Current network state
- `network`: Network instance

**Returns**: Array of `AgentResult[]` representing conversation history

### 3. appendResults Method

**Purpose**: Saves new messages to your database after a successful agent/network run.

```typescript
appendResults: async ({ threadId, results, state, network }) => {
  // Save only new results to avoid duplicates
  for (const result of results) {
    await db.message.create({
      data: {
        threadId,
        content: result.output[0]?.content || '',
        role: result.output[0]?.role || 'assistant',
        agentName: result.agentName,
        timestamp: new Date(result.timestamp || Date.now()),
        toolCalls: {
          create: result.toolCalls?.map(call => ({
            toolName: call.toolName,
            parameters: call.parameters,
            result: call.result
          })) || []
        }
      }
    });
  }
}
```

**Parameters**:
- `threadId`: Thread identifier
- `results`: New agent results to save
- `state`: Current network state
- `network`: Network instance

**Returns**: `void`

## Persistence Patterns

### 1. Server-Authoritative Pattern

The server maintains all conversation state. Client sends only `threadId`.

```typescript
// Client sends minimal state
const result = await network.run(userInput, {
  state: createState({ threadId: 'existing-thread-id' })
});

// History adapter loads full context
const historyAdapter: HistoryConfig = {
  get: async ({ threadId }) => {
    // Load complete conversation history
    return await loadFullConversationHistory(threadId);
  },
  
  appendResults: async ({ threadId, results }) => {
    // Save all new messages
    await saveNewMessages(threadId, results);
  }
};
```

**Pros**: 
- Consistent state management
- Reduced client complexity
- Perfect for web applications

**Cons**:
- Higher latency (database round trips)
- Server resource usage

### 2. Client-Authoritative Pattern

Client maintains complete conversation state locally.

```typescript
// Client maintains full history
const result = await network.run(userInput, {
  state: createState({ 
    userId: 'user-123',
    conversationHistory: fullLocalHistory 
  }, {
    messages: fullLocalHistory  // Client provides complete history
  })
});

// Minimal history adapter for persistence only
const historyAdapter: HistoryConfig = {
  createThread: async ({ state }) => {
    const threadId = await createEmptyThread(state.data.userId);
    return { threadId };
  },
  
  appendResults: async ({ threadId, results }) => {
    // Save for backup/analytics only
    await saveNewMessages(threadId, results);
  }
  
  // No get method - client provides all history
};
```

**Pros**:
- Optimal performance (no database reads)
- Offline capability
- Reduced server load

**Cons**:
- Client state management complexity
- Potential sync issues

### 3. Hybrid Pattern

Combines benefits of both patterns.

```typescript
const hybridAdapter: HistoryConfig = {
  createThread: async ({ state, input }) => {
    const thread = await db.thread.create({
      data: {
        userId: state.data.userId,
        title: input.slice(0, 50),
        lastAccessed: new Date()
      }
    });
    return { threadId: thread.id };
  },
  
  get: async ({ threadId, state }) => {
    // Load recent history only (e.g., last 20 messages)
    const recentMessages = await db.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    
    return recentMessages.reverse().map(formatMessage);
  },
  
  appendResults: async ({ threadId, results }) => {
    // Always persist new messages
    await saveNewMessages(threadId, results);
    
    // Cleanup old messages to maintain performance
    await cleanupOldMessages(threadId, maxAge: '30 days');
  }
};
```

## Integration with Intuivox Database

### Current Intuivox Schema Integration

```typescript
interface IntuivoxHistoryAdapter extends HistoryConfig<AgentState> {
  createThread: (params: CreateThreadParams<AgentState>) => Promise<{ threadId: string }>;
  get: (params: GetHistoryParams<AgentState>) => Promise<AgentResult[]>;
  appendResults: (params: AppendResultsParams<AgentState>) => Promise<void>;
}

const intuivoxHistoryAdapter: IntuivoxHistoryAdapter = {
  createThread: async ({ state, input }) => {
    // Create new project as conversation thread
    const project = await prisma.project.create({
      data: {
        name: extractProjectName(input) || `Project ${Date.now()}`,
        userId: state.data.userId || 'anonymous',
        createdAt: new Date()
      }
    });
    
    return { threadId: project.id };
  },

  get: async ({ threadId }) => {
    // Load conversation history from existing messages
    const messages = await prisma.message.findMany({
      where: { projectId: threadId },
      orderBy: { createdAt: 'asc' },
      include: { fragment: true }
    });
    
    // Convert Intuivox messages to AgentResult format
    return messages.map(message => {
      const output = [{
        type: 'text' as const,
        role: message.role === 'USER' ? 'user' as const : 'assistant' as const,
        content: message.content
      }];
      
      // Add tool calls for messages with fragments
      const toolCalls = message.fragment ? [{
        toolName: 'createOrUpdateFiles',
        parameters: { files: message.fragment.files },
        result: {
          sandboxUrl: message.fragment.sandboxUrl,
          title: message.fragment.title
        }
      }] : [];
      
      return {
        output,
        agentName: message.role === 'USER' ? 'user' : 'assistant',
        toolCalls,
        timestamp: message.createdAt.toISOString()
      };
    });
  },

  appendResults: async ({ threadId, results }) => {
    // Save new agent results as messages
    for (const result of results) {
      const output = result.output[0];
      if (!output || output.type !== 'text') continue;
      
      // Determine message type based on content and tool calls
      let messageType: 'RESULT' | 'ERROR' | 'AGENT_QUESTION' = 'RESULT';
      
      if (result.error) {
        messageType = 'ERROR';
      } else if (output.content.includes('?') && result.agentName === 'business-info-gatherer-agent') {
        messageType = 'AGENT_QUESTION';
      }
      
      // Create message with optional fragment
      const fragmentData = extractFragmentData(result.toolCalls);
      
      await prisma.message.create({
        data: {
          projectId: threadId,
          content: output.content,
          role: 'ASSISTANT',
          type: messageType,
          fragment: fragmentData ? {
            create: {
              sandboxUrl: fragmentData.sandboxUrl,
              title: fragmentData.title,
              files: fragmentData.files
            }
          } : undefined
        }
      });
    }
  }
};
```

### Enhanced Schema for History Support

Consider extending your Prisma schema to better support conversation history:

```prisma
model Project {
  id String @id @default(uuid())
  name String
  userId String
  
  // History support
  threadId String? @unique // Optional explicit thread ID
  conversationMetadata Json? // Store conversation context
  lastMessageAt DateTime?
  messageCount Int @default(0)
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  messages Message[]
}

model Message {
  id String @id @default(uuid())
  content String
  role MessageRole
  type MessageType
  
  // History support
  agentName String? // Which agent generated this message
  toolCalls Json? // Store tool execution details
  parentMessageId String? // For threaded conversations
  conversationTurn Int? // Sequential turn number
  
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  fragment Fragment?
  
  projectId String
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  // Self-referential for threaded conversations
  parentMessage Message? @relation("MessageThread", fields: [parentMessageId], references: [id])
  childMessages Message[] @relation("MessageThread")
}

// New model for conversation sessions
model ConversationSession {
  id String @id @default(uuid())
  projectId String
  userId String
  
  startedAt DateTime @default(now())
  endedAt DateTime?
  messageCount Int @default(0)
  
  // Session metadata
  userAgent String?
  ipAddress String?
  metadata Json?
  
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
}
```

## Advanced History Patterns

### Conversation Branching

```typescript
interface BranchingHistoryAdapter extends HistoryConfig {
  createBranch?: (params: {
    parentThreadId: string;
    branchPoint: number;
    state: any;
  }) => Promise<{ threadId: string }>;
  
  mergeBranches?: (params: {
    sourceThreadId: string;
    targetThreadId: string;
    state: any;
  }) => Promise<void>;
}

const branchingAdapter: BranchingHistoryAdapter = {
  createBranch: async ({ parentThreadId, branchPoint, state }) => {
    // Create new thread as branch
    const branch = await db.conversationBranch.create({
      data: {
        parentThreadId,
        branchPoint,
        userId: state.data.userId,
        createdAt: new Date()
      }
    });
    
    // Copy messages up to branch point
    const parentMessages = await db.message.findMany({
      where: { 
        threadId: parentThreadId,
        conversationTurn: { lte: branchPoint }
      }
    });
    
    await db.message.createMany({
      data: parentMessages.map(msg => ({
        ...msg,
        id: undefined, // Generate new IDs
        threadId: branch.id
      }))
    });
    
    return { threadId: branch.id };
  }
};
```

### Conversation Summarization

```typescript
const summarizingAdapter: HistoryConfig = {
  get: async ({ threadId, state }) => {
    const messageCount = await db.message.count({
      where: { threadId }
    });
    
    // If conversation is long, load summary + recent messages
    if (messageCount > 50) {
      const summary = await db.conversationSummary.findFirst({
        where: { threadId },
        orderBy: { createdAt: 'desc' }
      });
      
      const recentMessages = await db.message.findMany({
        where: { 
          threadId,
          createdAt: { gt: summary?.summaryEndDate || new Date(0) }
        },
        orderBy: { createdAt: 'asc' }
      });
      
      // Combine summary with recent messages
      return [
        ...(summary ? [formatSummaryAsAgentResult(summary)] : []),
        ...recentMessages.map(formatMessage)
      ];
    }
    
    // Load full history for shorter conversations
    return loadFullHistory(threadId);
  },
  
  appendResults: async ({ threadId, results }) => {
    await saveNewMessages(threadId, results);
    
    // Trigger summarization if conversation is getting long
    const messageCount = await db.message.count({
      where: { threadId }
    });
    
    if (messageCount > 100 && messageCount % 25 === 0) {
      await queueSummarizationJob(threadId);
    }
  }
};
```

### Multi-User Conversation Support

```typescript
const multiUserAdapter: HistoryConfig = {
  createThread: async ({ state, input }) => {
    const thread = await db.conversationThread.create({
      data: {
        title: input.slice(0, 50),
        type: 'multi_user',
        participants: {
          create: state.data.participants.map(userId => ({
            userId,
            role: 'participant',
            joinedAt: new Date()
          }))
        }
      }
    });
    
    return { threadId: thread.id };
  },
  
  get: async ({ threadId, state }) => {
    // Check user permissions
    const hasAccess = await checkUserAccess(
      threadId, 
      state.data.userId
    );
    
    if (!hasAccess) {
      throw new Error('Access denied to conversation thread');
    }
    
    return loadConversationHistory(threadId);
  },
  
  appendResults: async ({ threadId, results, state }) => {
    // Add user context to messages
    const enrichedResults = results.map(result => ({
      ...result,
      metadata: {
        userId: state.data.userId,
        timestamp: Date.now(),
        permissions: state.data.userPermissions
      }
    }));
    
    await saveMessages(threadId, enrichedResults);
    
    // Notify other participants
    await notifyParticipants(threadId, enrichedResults);
  }
};
```

## Performance Optimization

### Message Pagination

```typescript
const paginatedAdapter: HistoryConfig = {
  get: async ({ threadId, state }) => {
    const pageSize = 20;
    const page = state.data.historyPage || 0;
    
    const messages = await db.message.findMany({
      where: { threadId },
      orderBy: { createdAt: 'desc' },
      skip: page * pageSize,
      take: pageSize
    });
    
    // Store pagination info in state
    state.data.historyPage = page;
    state.data.hasMoreHistory = messages.length === pageSize;
    
    return messages.reverse().map(formatMessage);
  }
};
```

### Intelligent Caching

```typescript
const cachedAdapter: HistoryConfig = {
  get: async ({ threadId, state }) => {
    const cacheKey = `conversation:${threadId}`;
    
    // Try cache first
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Load from database
    const messages = await loadFullHistory(threadId);
    
    // Cache for 10 minutes
    await redis.setex(cacheKey, 600, JSON.stringify(messages));
    
    return messages;
  },
  
  appendResults: async ({ threadId, results }) => {
    await saveNewMessages(threadId, results);
    
    // Invalidate cache
    await redis.del(`conversation:${threadId}`);
  }
};
```

## Best Practices for Intuivox

### 1. Database Operations in Steps

```typescript
const robustAdapter: HistoryConfig = {
  createThread: async ({ state, input }, { step }) => {
    return await step.run('create-thread', async () => {
      const project = await prisma.project.create({
        data: {
          name: extractProjectName(input) || `Project ${Date.now()}`,
          userId: state.data.userId,
          conversationMetadata: {
            initialPrompt: input,
            createdVia: 'agent-kit-history'
          }
        }
      });
      
      return { threadId: project.id };
    });
  },
  
  appendResults: async ({ threadId, results }, { step }) => {
    return await step.run('append-results', async () => {
      // Batch insert for better performance
      const messageData = results.map(result => ({
        projectId: threadId,
        content: result.output[0]?.content || '',
        role: 'ASSISTANT' as const,
        type: determineMessageType(result),
        agentName: result.agentName
      }));
      
      await prisma.message.createMany({
        data: messageData
      });
    });
  }
};
```

### 2. Error Handling and Graceful Degradation

```typescript
const resilientAdapter: HistoryConfig = {
  get: async ({ threadId, state }) => {
    try {
      return await loadConversationHistory(threadId);
    } catch (error) {
      console.warn('Failed to load conversation history:', error);
      
      // Graceful degradation - return empty history
      // but log the error for monitoring
      await logHistoryError(threadId, error);
      
      return [];
    }
  },
  
  appendResults: async ({ threadId, results }) => {
    try {
      await saveNewMessages(threadId, results);
    } catch (error) {
      console.error('Failed to save conversation history:', error);
      
      // Store in fallback location (Redis, file, etc.)
      await saveToFallbackStorage(threadId, results);
      
      // Queue for retry
      await queueHistorySaveRetry(threadId, results);
    }
  }
};
```

### 3. Performance Monitoring

```typescript
const monitoredAdapter: HistoryConfig = {
  get: async ({ threadId }) => {
    const startTime = Date.now();
    
    try {
      const messages = await loadConversationHistory(threadId);
      
      // Log performance metrics
      const loadTime = Date.now() - startTime;
      console.log(`History load: ${loadTime}ms, ${messages.length} messages`);
      
      if (loadTime > 1000) {
        console.warn(`Slow history load detected: ${threadId}`);
      }
      
      return messages;
    } catch (error) {
      const loadTime = Date.now() - startTime;
      console.error(`History load failed after ${loadTime}ms:`, error);
      throw error;
    }
  }
};
```

This comprehensive History reference provides everything needed to understand, implement, and optimize persistent conversations in Intuivox, enabling your multi-agent workflows to maintain context across sessions and provide seamless user experiences.