# AgentKit Tools - Implementation Reference for Intuivox

## Overview

Tools in AgentKit are **functions that extend Agent capabilities** beyond text generation. They enable agents to interact with external systems, transform data, and perform specific actions based on AI model decisions.

## Core Purposes

Tools serve two primary functions:

1. **System Integration** - Enable models to interact with databases, APIs, file systems, and external services
2. **Data Transformation** - Convert unstructured inputs into structured, typed responses

## Tool Architecture

Tools integrate with AI models through **function calling** (OpenAI) or **tool use** (Anthropic Claude) mechanisms, allowing models to dynamically select and execute appropriate tools based on context and requirements.

## Tool Structure

Every tool consists of four essential components:

### 1. Name
- **Purpose**: Unique identifier for the tool
- **Requirements**: Should be descriptive and clear
- **Example**: `'ask_user_question'`, `'terminal'`, `'createOrUpdateFiles'`

### 2. Description  
- **Purpose**: Explains the tool's functionality and usage context
- **Requirements**: Clear, detailed explanation that helps AI models understand when to use the tool
- **Example**: `"Ask the user a question and wait for their response"`

### 3. Parameters
- **Purpose**: Defines input schema using Zod validation
- **Requirements**: Strongly typed, comprehensive parameter definitions
- **Important**: Use `.nullable()` for optional parameters, NOT `.optional()`

### 4. Handler
- **Purpose**: The actual function that executes when the tool is called
- **Requirements**: Async function that processes inputs and returns results
- **Context**: Receives additional context objects for advanced functionality

## Basic Tool Creation

```typescript
import { createTool } from "@inngest/agent-kit";
import { z } from "zod";

const simpleGreetingTool = createTool({
  name: 'greet_user',
  description: 'Generate a personalized greeting for a user',
  parameters: z.object({
    userName: z.string().describe('The name of the user to greet'),
    timeOfDay: z.enum(['morning', 'afternoon', 'evening']).describe('Current time of day')
  }),
  handler: async ({ userName, timeOfDay }) => {
    const greeting = `Good ${timeOfDay}, ${userName}!`;
    return { message: greeting, timestamp: new Date().toISOString() };
  }
});
```

## Advanced Tool Configuration

### Complex Parameter Schemas

```typescript
const fileOperationTool = createTool({
  name: 'file_operations',
  description: 'Perform various file system operations',
  parameters: z.object({
    operation: z.enum(['read', 'write', 'delete', 'list']),
    path: z.string().describe('File or directory path'),
    content: z.string().nullable().describe('Content for write operations'),
    options: z.object({
      encoding: z.enum(['utf8', 'base64']).default('utf8'),
      createDirectories: z.boolean().default(false),
      recursive: z.boolean().default(false)
    }).nullable()
  }),
  handler: async ({ operation, path, content, options }, { step, network }) => {
    // Implementation with context objects
    return await step.run('file-operation', async () => {
      switch (operation) {
        case 'read':
          return await readFile(path, options?.encoding);
        case 'write':
          if (!content) throw new Error('Content required for write operation');
          return await writeFile(path, content, options);
        // ... other operations
      }
    });
  }
});
```

## Context Objects Deep Dive

Tool handlers receive three context objects that provide access to advanced functionality:

### Network Context
- **Purpose**: Access to shared network state and cross-agent communication
- **Usage**: Read/write shared data, coordinate between agents

```typescript
handler: async (params, { network }) => {
  // Access shared state
  const currentState = network?.state?.data;
  
  // Update shared state
  if (network) {
    network.state.data.lastOperation = 'file_created';
    network.state.data.fileCount = (network.state.data.fileCount || 0) + 1;
  }
  
  return result;
}
```

### Step Context
- **Purpose**: Inngest step functions for durability and retry logic
- **Usage**: Wrap operations for automatic retries, event handling, waiting

```typescript
handler: async (params, { step }) => {
  // Durable step execution with automatic retries
  const result = await step.run('database-query', async () => {
    return await database.query(params.sql);
  });
  
  // Send events
  await step.sendEvent('operation-completed', {
    name: 'tool/operation-completed',
    data: { result, timestamp: Date.now() }
  });
  
  // Wait for external events
  const userResponse = await step.waitForEvent('user-response', {
    event: 'user/response',
    timeout: '5m'
  });
  
  return { result, userResponse };
}
```

### Agent Context
- **Purpose**: Access to current agent information and state
- **Usage**: Agent-specific logic, conditional behavior based on agent type

```typescript
handler: async (params, { agent }) => {
  // Access agent information
  console.log(`Tool called by agent: ${agent.name}`);
  
  // Agent-specific behavior
  if (agent.name === 'code-agent') {
    return await handleCodeAgentRequest(params);
  } else if (agent.name === 'business-info-gatherer') {
    return await handleBusinessInfoRequest(params);
  }
  
  return defaultHandler(params);
}
```

## Parameter Schema Best Practices

### Required vs Optional Parameters

```typescript
parameters: z.object({
  // Required parameters
  userId: z.string().describe('User identifier'),
  action: z.enum(['create', 'update', 'delete']),
  
  // Optional parameters - use .nullable(), not .optional()
  metadata: z.object({
    tags: z.array(z.string()),
    priority: z.number().min(1).max(5)
  }).nullable().describe('Optional metadata for the operation'),
  
  // Parameters with defaults
  timeout: z.number().default(30000).describe('Timeout in milliseconds'),
  
  // Complex nested objects
  configuration: z.object({
    environment: z.enum(['development', 'staging', 'production']),
    features: z.array(z.string()).default([]),
    settings: z.record(z.string(), z.unknown()).nullable()
  })
})
```

### Type Safety and Validation

```typescript
const databaseQueryTool = createTool({
  name: 'database_query',
  description: 'Execute database queries with proper validation',
  parameters: z.object({
    query: z.string().min(1).describe('SQL query to execute'),
    params: z.array(z.unknown()).default([]).describe('Query parameters'),
    options: z.object({
      timeout: z.number().positive().max(60000).default(30000),
      maxRows: z.number().positive().max(10000).default(1000),
      readonly: z.boolean().default(true)
    }).nullable()
  }),
  handler: async ({ query, params, options }) => {
    // Handler receives strongly typed parameters
    const safeOptions = options || {};
    
    // Validation and sanitization
    if (!safeOptions.readonly && query.toLowerCase().includes('drop')) {
      throw new Error('Destructive operations not allowed');
    }
    
    return await executeQuery(query, params, safeOptions);
  }
});
```

## Current Intuivox Tool Implementations

### Ask User Question Tool

```typescript
export const askUserQuestionTool = createTool({
  name: "ask_user_question",
  description: "Ask the user a question",
  parameters: z.object({
    question: z.string().describe("The question to ask the user"),
  }),
  handler: async ({ question }, { step, network }) => {
    const projectId = network?.state?.data?.projectId;

    // Send event to create user question
    await step?.sendEvent(
      { id: "event-user-question" },
      {
        name: "app/user-agent-question",
        data: { question: question, projectId: projectId },
      }
    );

    // Wait for user response
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
```

### Terminal Tool

```typescript
const terminalTool = createTool({
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

        // Update sandbox ID if new one was created
        if (newSandboxId) {
          network.state.data.sandboxId = newSandboxId;
        }

        const result = await sandbox.commands.run(command, {
          onStdout: (data: string) => { buffers.stdout += data; },
          onStderr: (data: string) => { buffers.stderr += data; },
        });
        
        return result.stdout;
      } catch (err) {
        console.error(`Command failed: ${err}`);
        return `Command failed: ${err}\nstdout: ${buffers.stdout}\nstderr: ${buffers.stderr}`;
      }
    });
  },
});
```

### File System Tool

```typescript
const createOrUpdateFilesTool = createTool({
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
  handler: async ({ files }, { step, network }: Tool.Options<AgentState>) => {
    const newFiles = await step?.run("createOrUpdateFiles", async () => {
      try {
        const updatedFiles = network.state.data.files || {};
        const currentSandboxId = network.state.data.sandboxId;

        const { sandbox, newSandboxId } = await getSandboxWithFallback(
          currentSandboxId,
          updatedFiles
        );

        // Update sandbox ID if new one was created
        if (newSandboxId) {
          network.state.data.sandboxId = newSandboxId;
        }

        // Write all files to sandbox
        for (const file of files) {
          await sandbox.files.write(file.path, file.content);
          updatedFiles[file.path] = file.content;
        }
        
        return updatedFiles;
      } catch (e) {
        return "Error: " + e;
      }
    });
    
    // Update network state with new files
    if (typeof newFiles === "object") {
      network.state.data.files = newFiles;
    }
  },
});
```

## Error Handling and Resilience

### Graceful Error Handling

```typescript
const resilientTool = createTool({
  name: 'resilient_operation',
  description: 'Performs operations with comprehensive error handling',
  parameters: z.object({
    operation: z.string(),
    data: z.unknown()
  }),
  handler: async ({ operation, data }, { step }) => {
    return await step.run('resilient-operation', async () => {
      try {
        // Attempt primary operation
        const result = await performOperation(operation, data);
        return { success: true, result };
      } catch (primaryError) {
        console.warn('Primary operation failed, attempting fallback:', primaryError);
        
        try {
          // Attempt fallback operation
          const fallbackResult = await performFallbackOperation(operation, data);
          return { 
            success: true, 
            result: fallbackResult, 
            warning: 'Used fallback method' 
          };
        } catch (fallbackError) {
          // Log error and return structured failure
          console.error('Both primary and fallback operations failed:', {
            primary: primaryError,
            fallback: fallbackError
          });
          
          return {
            success: false,
            error: 'Operation failed after retry attempts',
            details: {
              primaryError: primaryError.message,
              fallbackError: fallbackError.message
            }
          };
        }
      }
    });
  }
});
```

### Validation and Sanitization

```typescript
const validatedTool = createTool({
  name: 'validated_input',
  description: 'Tool with comprehensive input validation',
  parameters: z.object({
    filePath: z.string().regex(/^[a-zA-Z0-9\/\-_.]+$/, 'Invalid file path format'),
    content: z.string().max(100000, 'Content too large'),
    options: z.object({
      overwrite: z.boolean().default(false),
      backup: z.boolean().default(true)
    }).nullable()
  }),
  handler: async ({ filePath, content, options }, { step }) => {
    // Additional runtime validation
    if (filePath.includes('..')) {
      throw new Error('Path traversal not allowed');
    }
    
    if (content.includes('<script>')) {
      throw new Error('Script tags not allowed in content');
    }
    
    return await step.run('validated-file-write', async () => {
      const safeOptions = options || { overwrite: false, backup: true };
      
      // Create backup if requested
      if (safeOptions.backup && await fileExists(filePath)) {
        await createBackup(filePath);
      }
      
      // Write file with validation
      return await writeFileSecurely(filePath, content, safeOptions);
    });
  }
});
```

## Integration Patterns

### Tool Composition

```typescript
// Create reusable utility tools
const loggerTool = createTool({
  name: 'log_operation',
  description: 'Log operation details',
  parameters: z.object({
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
    metadata: z.record(z.unknown()).nullable()
  }),
  handler: async ({ level, message, metadata }) => {
    console[level](message, metadata);
    return { logged: true, timestamp: Date.now() };
  }
});

// Combine tools in agent
const composedAgent = createAgent({
  name: 'composed-agent',
  system: 'You have access to logging and file operations...',
  model: openai('gpt-4o'),
  tools: [loggerTool, fileOperationTool, terminalTool]
});
```

### Cross-Agent Tool Sharing

```typescript
// Define shared tools that multiple agents can use
const sharedTools = [
  askUserQuestionTool,
  loggerTool,
  fileValidationTool
];

// Business agent with conversation tools
const businessAgent = createAgent({
  name: 'business-agent',
  tools: [...sharedTools, businessSpecificTool]
});

// Code agent with development tools  
const codeAgent = createAgent({
  name: 'code-agent',
  tools: [...sharedTools, terminalTool, fileSystemTool]
});
```

## Performance Optimization

### Caching and Memoization

```typescript
const cachedQueryTool = createTool({
  name: 'cached_query',
  description: 'Execute queries with caching',
  parameters: z.object({
    query: z.string(),
    cacheKey: z.string().nullable(),
    cacheTTL: z.number().default(300) // 5 minutes
  }),
  handler: async ({ query, cacheKey, cacheTTL }, { step, network }) => {
    const effectiveKey = cacheKey || generateCacheKey(query);
    
    return await step.run('cached-query-execution', async () => {
      // Check cache first
      const cached = await getFromCache(effectiveKey);
      if (cached && !isCacheExpired(cached, cacheTTL)) {
        return { ...cached.data, fromCache: true };
      }
      
      // Execute query
      const result = await executeQuery(query);
      
      // Cache result
      await setCache(effectiveKey, result, cacheTTL);
      
      return { ...result, fromCache: false };
    });
  }
});
```

### Resource Management

```typescript
const resourceManagedTool = createTool({
  name: 'resource_managed_operation',
  description: 'Operation with proper resource cleanup',
  parameters: z.object({
    resourceType: z.enum(['database', 'file', 'network']),
    operation: z.string()
  }),
  handler: async ({ resourceType, operation }, { step }) => {
    return await step.run('resource-managed-op', async () => {
      let resource = null;
      
      try {
        // Acquire resource
        resource = await acquireResource(resourceType);
        
        // Perform operation
        const result = await performOperationWithResource(resource, operation);
        
        return result;
      } finally {
        // Always cleanup resource
        if (resource) {
          await releaseResource(resource);
        }
      }
    });
  }
});
```

## Best Practices for Intuivox

### 1. Clear Tool Design
- Write descriptive names and comprehensive descriptions
- Use specific, focused tools rather than overly generic ones
- Include usage examples in descriptions when helpful

### 2. Type Safety
- Always use Zod schemas for parameter validation
- Use `.nullable()` for optional parameters, not `.optional()`
- Include detailed parameter descriptions

### 3. Error Handling  
- Implement graceful error handling in all tool handlers
- Return structured error responses that agents can understand
- Use step.run() for operations that might need retry logic

### 4. State Management
- Use network context for shared state between agents
- Update state consistently after tool operations
- Consider state cleanup for long-running processes

### 5. Performance
- Use step.run() for expensive operations to enable caching
- Implement appropriate timeouts for external operations
- Consider caching for frequently accessed data

### 6. Security
- Validate and sanitize all inputs
- Implement proper authentication for external API calls
- Avoid exposing sensitive information in tool responses
- Use environment variables for configuration

### 7. Monitoring and Debugging
- Include comprehensive logging in tool handlers
- Use structured error messages
- Implement metrics collection for tool usage and performance

## Security Considerations

### Input Validation
```typescript
const secureTool = createTool({
  name: 'secure_operation',
  parameters: z.object({
    userInput: z.string()
      .min(1, 'Input required')
      .max(1000, 'Input too long')
      .regex(/^[a-zA-Z0-9\s\-_.@]+$/, 'Invalid characters in input'),
    filePath: z.string()
      .refine(path => !path.includes('..'), 'Path traversal not allowed')
      .refine(path => path.startsWith('/safe/'), 'Path must be in safe directory')
  }),
  handler: async ({ userInput, filePath }) => {
    // Additional runtime validation
    const sanitizedInput = sanitizeString(userInput);
    const safePath = path.resolve(filePath);
    
    if (!safePath.startsWith('/safe/')) {
      throw new Error('Invalid file path');
    }
    
    return await performSecureOperation(sanitizedInput, safePath);
  }
});
```

### Authentication and Authorization
```typescript
const authenticatedTool = createTool({
  name: 'authenticated_operation',
  parameters: z.object({
    operation: z.string(),
    data: z.unknown()
  }),
  handler: async ({ operation, data }, { network }) => {
    // Verify user authentication
    const userId = network?.state?.data?.userId;
    if (!userId) {
      throw new Error('Authentication required');
    }
    
    // Check authorization
    const hasPermission = await checkUserPermission(userId, operation);
    if (!hasPermission) {
      throw new Error('Insufficient permissions');
    }
    
    return await performAuthorizedOperation(operation, data, userId);
  }
});
```

This comprehensive reference provides everything needed to understand, implement, and extend tools in the Intuivox codebase, with specific examples and best practices tailored to your AI-powered application architecture.