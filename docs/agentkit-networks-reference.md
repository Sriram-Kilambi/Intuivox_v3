# AgentKit Networks - Implementation Reference for Intuivox

## Overview

Networks in AgentKit are **systems of agents** that create powerful AI workflows by combining multiple specialized agents. They enable complex, multi-step problem-solving through coordinated agent collaboration with shared state and intelligent routing.

## Core Concept

Networks operate like **"while loops with memory"** that:
1. Begin with a user prompt
2. Use a router to select the appropriate agent
3. Execute the selected agent and its tools
4. Store results in shared state
5. Repeat until completion or maximum iterations reached

This creates adaptive, multi-agent workflows that can handle complex tasks requiring different specialized capabilities.

## Network Architecture

### Essential Components

1. **Agents** - The executable units that perform specific tasks
2. **State** - Shared memory including conversation history and key-value data store
3. **Router** - Decision-making function that determines agent selection and workflow progression

### Execution Flow

```
User Input → Router → Agent Selection → Agent Execution → State Update → Router → ...
```

The network continues iterating until:
- Router returns `null` or `undefined` (completion)
- Maximum iteration limit is reached
- An error occurs

## Basic Network Creation

```typescript
import { createNetwork, createAgent, openai } from "@inngest/agent-kit";

const simpleNetwork = createNetwork({
  name: 'basic-workflow',
  agents: [researchAgent, summaryAgent],
  defaultModel: openai({ model: 'gpt-4o' }),
  maxIter: 10,
  router: ({ network, lastResult, callCount }) => {
    // Simple sequential routing
    if (callCount === 0) return researchAgent;
    if (callCount === 1) return summaryAgent;
    return null; // Complete the workflow
  }
});
```

## Advanced Network Configuration

### Complex Router Logic

```typescript
const intelligentNetwork = createNetwork({
  name: 'intelligent-workflow',
  agents: [planningAgent, researchAgent, codeAgent, reviewAgent],
  defaultModel: openai({ model: 'gpt-4o' }),
  maxIter: 20,
  router: ({ network, lastResult, callCount, input }) => {
    const state = network.state.data;
    
    // Initial planning phase
    if (callCount === 0) {
      return planningAgent;
    }
    
    // Check if we have a plan
    if (!state.plan) {
      return planningAgent;
    }
    
    // Research phase - gather information
    if (!state.researchComplete) {
      if (state.researchAttempts < 3) {
        return researchAgent;
      } else {
        state.researchComplete = true;
      }
    }
    
    // Code generation phase
    if (state.researchComplete && !state.codeComplete) {
      return codeAgent;
    }
    
    // Review phase
    if (state.codeComplete && !state.reviewComplete) {
      return reviewAgent;
    }
    
    // Completion condition
    if (state.reviewComplete) {
      return null; // End the network
    }
    
    // Default fallback
    return planningAgent;
  },
  defaultState: createState({
    plan: null,
    researchComplete: false,
    researchAttempts: 0,
    codeComplete: false,
    reviewComplete: false
  })
});
```

## State Management

### State Structure

Networks maintain two types of state:

1. **Message History** - Automatic conversation tracking
2. **Custom Data** - Key-value store for workflow state

```typescript
interface NetworkState {
  messages: Message[]; // Automatic message history
  data: {             // Custom state object
    // Your custom state properties
    currentPhase: string;
    completedTasks: string[];
    userPreferences: object;
    // ... any other data
  };
}
```

### State Operations

```typescript
const statefulNetwork = createNetwork({
  agents: [agent1, agent2],
  router: ({ network }) => {
    const state = network.state.data;
    
    // Read state
    const currentPhase = state.currentPhase;
    const tasksCompleted = state.completedTasks?.length || 0;
    
    // Update state
    state.lastRouterCall = Date.now();
    state.iterationCount = (state.iterationCount || 0) + 1;
    
    // Conditional routing based on state
    if (currentPhase === 'planning') {
      return planningAgent;
    } else if (currentPhase === 'execution' && tasksCompleted < 3) {
      return executionAgent;
    }
    
    return null; // Complete
  },
  defaultState: createState({
    currentPhase: 'planning',
    completedTasks: [],
    iterationCount: 0
  })
});
```

## Router Function Deep Dive

The router function is the heart of network orchestration, receiving comprehensive context:

```typescript
router: ({ network, lastResult, callCount, input }) => {
  // network: Full network state and configuration
  // lastResult: Result from the previous agent execution
  // callCount: Number of agents that have been executed
  // input: Original user input to the network
  
  return selectedAgent | null;
}
```

### Router Context Properties

- **`network`**: Complete network instance with state access
- **`lastResult`**: Previous agent's execution result including output and tool calls
- **`callCount`**: Zero-based count of agent executions
- **`input`**: Original user prompt that started the network

### Advanced Router Patterns

```typescript
const adaptiveRouter = ({ network, lastResult, callCount, input }) => {
  const state = network.state.data;
  
  // Error handling and recovery
  if (lastResult?.error) {
    console.warn('Agent execution failed, attempting recovery');
    return recoveryAgent;
  }
  
  // Dynamic agent selection based on content analysis
  const lastOutput = lastResult?.output?.[0]?.content;
  if (lastOutput?.includes('code_required')) {
    return codeAgent;
  } else if (lastOutput?.includes('research_needed')) {
    return researchAgent;
  }
  
  // Progress tracking
  const progress = calculateProgress(state);
  if (progress < 0.5) {
    return continueCurrentPhase(state);
  }
  
  // Completion conditions
  if (isWorkflowComplete(state)) {
    return null;
  }
  
  // Safety valve - prevent infinite loops
  if (callCount > 15) {
    console.warn('Maximum iterations approached, forcing completion');
    return finalizationAgent;
  }
  
  return defaultAgent;
};
```

## Current Intuivox Network Implementation

### Multi-Agent Coding Network

```typescript
const network = createNetwork<AgentState>({
  name: "coding-agent-network",
  agents: [codeAgent, businessInfoGathererAgent],
  maxIter: 15,
  defaultState: state,
  router: async ({ network }) => {
    const summary = network.state.data.summary;
    
    // Stop condition - task is complete
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

    // Route to business info gatherer if info is incomplete
    if (!isBusinessInfoComplete) {
      return businessInfoGathererAgent;
    }

    // Route to code agent if business info is complete
    return codeAgent;
  },
});
```

### State Structure for Intuivox

```typescript
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
```

## Network Execution Lifecycle

### 1. Initialization
```typescript
const result = await network.run(userInput, { state: initialState });
```

### 2. Router Selection
- Router evaluates current state and context
- Returns selected agent or null for completion

### 3. Agent Execution
- Selected agent processes input with available tools
- Agent lifecycle hooks execute (onStart, onResponse, onFinish)
- Results are stored in network state

### 4. State Update
- Message history is automatically updated
- Custom state is modified by agents through lifecycle hooks
- Network state persists across iterations

### 5. Iteration Decision
- Router is called again with updated context
- Process repeats until completion or max iterations

## Best Practices for Intuivox

### 1. Clear Agent Responsibilities

Design agents with specific, well-defined purposes:

```typescript
const businessInfoGathererAgent = createAgent({
  name: "business-info-gatherer-agent",
  description: "Collects business information through conversational Q&A",
  // ... specialized for information gathering
});

const codeAgent = createAgent({
  name: "code-agent", 
  description: "Generates Next.js applications in sandbox environments",
  // ... specialized for code generation
});
```

### 2. Robust Router Logic

Implement comprehensive routing with error handling:

```typescript
router: ({ network, lastResult, callCount }) => {
  try {
    // Check for errors first
    if (lastResult?.error) {
      return handleError(lastResult.error, network.state);
    }
    
    // Implement business logic
    const state = network.state.data;
    
    // Progress-based routing
    return determineNextAgent(state, callCount);
    
  } catch (error) {
    console.error('Router error:', error);
    return null; // Safe termination
  }
}
```

### 3. State Management Strategy

Design state structure for clarity and maintainability:

```typescript
const defaultState = createState({
  // Workflow control
  phase: 'initialization',
  completed: false,
  
  // Business context
  businessInfo: {},
  
  // Technical assets
  files: {},
  sandboxId: null,
  
  // Progress tracking
  attempts: 0,
  errors: []
});
```

### 4. Iteration Control

Set appropriate limits and monitoring:

```typescript
const controlledNetwork = createNetwork({
  agents: [...agents],
  maxIter: 20, // Reasonable limit
  router: ({ callCount, network }) => {
    // Progress monitoring
    if (callCount > 15) {
      console.warn('Approaching iteration limit');
    }
    
    // Forced completion conditions
    if (callCount > 18) {
      return finalizationAgent;
    }
    
    return normalRouter(network);
  }
});
```

### 5. Error Handling and Recovery

Implement comprehensive error handling:

```typescript
const resilientRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Track errors
  if (lastResult?.error) {
    state.errors = state.errors || [];
    state.errors.push({
      iteration: callCount,
      agent: lastResult.agentName,
      error: lastResult.error,
      timestamp: Date.now()
    });
    
    // Recovery strategies
    if (state.errors.length > 3) {
      console.error('Multiple errors detected, terminating workflow');
      return null;
    }
    
    // Retry with different agent
    return selectRecoveryAgent(lastResult.error);
  }
  
  return normalRouting(state);
};
```

## Advanced Network Patterns

### Conditional Branching Network

```typescript
const branchingNetwork = createNetwork({
  agents: [classifierAgent, pathAAgent, pathBAgent, mergerAgent],
  router: ({ network, lastResult, callCount }) => {
    const state = network.state.data;
    
    if (callCount === 0) return classifierAgent;
    
    // Branch based on classification
    if (state.classification === 'typeA') {
      if (!state.pathAComplete) return pathAAgent;
    } else if (state.classification === 'typeB') {
      if (!state.pathBComplete) return pathBAgent;
    }
    
    // Merge results
    if (state.pathAComplete || state.pathBComplete) {
      if (!state.merged) return mergerAgent;
    }
    
    return null; // Complete
  }
});
```

### Parallel Processing Simulation

```typescript
const parallelNetwork = createNetwork({
  agents: [coordinatorAgent, workerAgent1, workerAgent2, aggregatorAgent],
  router: ({ network, lastResult, callCount }) => {
    const state = network.state.data;
    
    // Coordinate tasks
    if (callCount === 0) return coordinatorAgent;
    
    // Process tasks in pseudo-parallel fashion
    if (state.tasks && state.tasks.length > 0) {
      const nextTask = state.tasks.shift();
      state.currentTask = nextTask;
      
      // Route to appropriate worker
      return nextTask.type === 'A' ? workerAgent1 : workerAgent2;
    }
    
    // Aggregate results when all tasks complete
    if (state.results && state.results.length === state.totalTasks) {
      return aggregatorAgent;
    }
    
    return null;
  }
});
```

### Quality Assurance Network

```typescript
const qaNetwork = createNetwork({
  agents: [generatorAgent, validatorAgent, revisorAgent],
  router: ({ network, lastResult, callCount }) => {
    const state = network.state.data;
    
    // Generate initial output
    if (!state.generated) return generatorAgent;
    
    // Validate output
    if (!state.validated) return validatorAgent;
    
    // Revise if validation failed
    if (state.validated === false && state.revisions < 3) {
      state.revisions = (state.revisions || 0) + 1;
      state.generated = false; // Reset for regeneration
      return revisorAgent;
    }
    
    // Complete if validated or max revisions reached
    return null;
  }
});
```

## Performance Optimization

### State Cleanup

```typescript
const optimizedRouter = ({ network }) => {
  const state = network.state.data;
  
  // Clean up large temporary data
  if (state.tempData && state.phase === 'complete') {
    delete state.tempData;
  }
  
  // Limit message history size
  if (network.state.messages.length > 50) {
    network.state.messages = network.state.messages.slice(-30);
  }
  
  return selectAgent(state);
};
```

### Conditional Tool Loading

```typescript
const efficientAgent = createAgent({
  name: 'efficient-agent',
  tools: [], // Start with no tools
  lifecycle: {
    onStart: ({ network }) => {
      const state = network.state.data;
      
      // Dynamically add tools based on state
      if (state.needsFileOperations) {
        this.tools.push(fileOperationTool);
      }
      if (state.needsNetworkAccess) {
        this.tools.push(networkTool);
      }
      
      return prompt;
    }
  }
});
```

## Monitoring and Debugging

### Comprehensive Logging

```typescript
const monitoredNetwork = createNetwork({
  agents: agents,
  router: ({ network, lastResult, callCount }) => {
    // Log routing decisions
    console.log(`Router call ${callCount}:`, {
      timestamp: Date.now(),
      state: network.state.data,
      lastAgent: lastResult?.agentName,
      decision: 'evaluating...'
    });
    
    const nextAgent = routingLogic(network, lastResult, callCount);
    
    console.log(`Router decision: ${nextAgent?.name || 'COMPLETE'}`);
    
    return nextAgent;
  }
});
```

### State Inspection

```typescript
const debuggableRouter = ({ network, callCount }) => {
  // Periodic state dumps
  if (callCount % 5 === 0) {
    console.log('Network state snapshot:', {
      iteration: callCount,
      state: JSON.stringify(network.state.data, null, 2),
      messageCount: network.state.messages.length
    });
  }
  
  return routingLogic(network);
};
```

## Security Considerations

### State Validation

```typescript
const secureRouter = ({ network }) => {
  const state = network.state.data;
  
  // Validate state integrity
  if (!validateState(state)) {
    console.error('State validation failed');
    return null;
  }
  
  // Sanitize sensitive data
  if (state.userInput) {
    state.userInput = sanitizeInput(state.userInput);
  }
  
  return selectAgent(state);
};
```

### Access Control

```typescript
const authorizedNetwork = createNetwork({
  agents: agents,
  router: ({ network, input }) => {
    // Verify authorization for sensitive operations
    if (requiresAuthorization(input)) {
      const userId = network.state.data.userId;
      if (!hasPermission(userId, 'sensitive_operations')) {
        return unauthorizedAgent;
      }
    }
    
    return authorizedRouting(network);
  }
});
```

This comprehensive Networks reference provides everything needed to understand, implement, and optimize multi-agent workflows in Intuivox, with specific focus on your current business info gathering and code generation coordination pattern.