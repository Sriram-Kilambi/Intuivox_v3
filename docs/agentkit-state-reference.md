# AgentKit State - Implementation Reference for Intuivox

## Overview

State in AgentKit is a **shared memory and context mechanism** that enables agents within a network to store, access, and pass information between each other. It serves as the coordination layer for multi-agent workflows, maintaining both conversation history and structured data.

## Core Concepts

State provides two primary storage mechanisms:

1. **Message History** - Chronological record of all agent interactions and outputs
2. **Typed State Data** - Structured key-value store for workflow-specific information

### Key Characteristics

- **Shared Memory**: Accessible by all agents within a network
- **Session Scoped**: Persists during a single network `run()` call
- **Non-Persistent**: Does not persist across different network executions
- **Strongly Typed**: Supports TypeScript interfaces for structured data
- **Dynamic**: Can be updated and modified throughout workflow execution

## State Structure

### Basic Structure

```typescript
interface NetworkState {
  messages: Message[];  // Automatically managed message history
  data: T;              // Custom typed data object
}
```

### Message History

AgentKit automatically maintains a chronological record of:
- User inputs
- Agent responses  
- Tool executions
- System messages

### Custom State Data

User-defined structured data for workflow coordination:

```typescript
interface CustomState {
  currentPhase: string;
  completedTasks: string[];
  userPreferences: object;
  processedFiles: { [path: string]: string };
}
```

## State Creation and Initialization

### Basic State Creation

```typescript
import { createState } from "@inngest/agent-kit";

const state = createState({
  phase: 'initialization',
  completed: false
});
```

### Typed State Creation

```typescript
interface WorkflowState {
  projectId: string;
  currentStep: number;
  results: string[];
}

const typedState = createState<WorkflowState>({
  projectId: 'default-project',
  currentStep: 0,
  results: []
});
```

### State with Default Values

```typescript
interface BusinessWorkflowState {
  businessInfo: {
    name: string;
    description: string;
    industry: string;
  };
  requirements: string[];
  generatedFiles: { [path: string]: string };
}

const defaultState = createState<BusinessWorkflowState>({
  businessInfo: {
    name: '',
    description: '',
    industry: ''
  },
  requirements: [],
  generatedFiles: {}
});
```

## State Access Patterns

### Reading State Data

```typescript
// In router function
router: ({ network }) => {
  const state = network.state.data;
  
  // Access specific properties
  const currentPhase = state.currentPhase;
  const isComplete = state.completed;
  const fileCount = Object.keys(state.files || {}).length;
  
  return selectAgent(state);
}

// In tool handler
handler: async (params, { network }) => {
  const state = network.state.data;
  
  // Read current state
  const existingData = state.processedData || [];
  
  return result;
}
```

### Updating State Data

```typescript
// Direct property updates
handler: async (params, { network }) => {
  const state = network.state.data;
  
  // Simple updates
  state.currentStep += 1;
  state.lastUpdate = Date.now();
  
  // Object updates
  state.results.push(newResult);
  state.metadata = { ...state.metadata, newField: value };
  
  return result;
}

// Complex nested updates
handler: async (params, { network }) => {
  const state = network.state.data;
  
  // Update nested objects
  state.businessInfo = {
    ...state.businessInfo,
    name: params.businessName
  };
  
  // Update collections
  state.files = {
    ...state.files,
    [params.filePath]: params.content
  };
  
  return result;
}
```

## Current Intuivox State Implementation

### AgentState Interface

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

### State Initialization in Intuivox

```typescript
const state = createState<AgentState>(
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
    messages: previousMessages,  // Initialize with conversation history
  }
);
```

### State Updates in Agent Lifecycle

```typescript
// Business Info Gatherer Agent - onResponse hook
lifecycle: {
  onResponse: async ({ result, network }) => {
    const lastAssistantMessageText = lastAssistantTextMessageContent(result);

    if (lastAssistantMessageText && network) {
      // Extract business info from structured tags
      if (lastAssistantMessageText.includes("<business_info>")) {
        const businessInfoMatch = lastAssistantMessageText.match(
          /<business_info>([\s\S]*?)<\/business_info>/
        );
        if (businessInfoMatch) {
          try {
            const parsedBusinessInfo = JSON.parse(businessInfoMatch[1]);
            
            // Update state with collected business information
            network.state.data.businessInfo = {
              ...network.state.data.businessInfo,
              ...parsedBusinessInfo,
            };
          } catch {
            console.log("Could not parse business info as JSON, skipping...");
          }
        }
      }
    }
    return result;
  },
}
```

### State-Based Routing in Intuivox

```typescript
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

  // Route based on state completeness
  if (!isBusinessInfoComplete) {
    return businessInfoGathererAgent;
  }

  return codeAgent;
},
```

## Advanced State Management Patterns

### State Validation

```typescript
interface ValidatedState {
  phase: 'planning' | 'execution' | 'review' | 'complete';
  data: unknown;
}

const validateState = (state: any): state is ValidatedState => {
  return state &&
    typeof state.phase === 'string' &&
    ['planning', 'execution', 'review', 'complete'].includes(state.phase) &&
    state.data !== undefined;
};

// Usage in router
router: ({ network }) => {
  const state = network.state.data;
  
  if (!validateState(state)) {
    console.error('Invalid state detected');
    return null; // Terminate workflow
  }
  
  return selectAgent(state);
}
```

### State Snapshots and Rollback

```typescript
interface SnapshotState {
  current: WorkflowData;
  snapshots: WorkflowData[];
  canRollback: boolean;
}

const createSnapshot = (network: Network<SnapshotState>) => {
  const state = network.state.data;
  state.snapshots.push(JSON.parse(JSON.stringify(state.current)));
  state.canRollback = true;
};

const rollbackState = (network: Network<SnapshotState>) => {
  const state = network.state.data;
  if (state.snapshots.length > 0) {
    state.current = state.snapshots.pop()!;
    state.canRollback = state.snapshots.length > 0;
  }
};
```

### Conditional State Updates

```typescript
const conditionalUpdateTool = createTool({
  name: 'conditional_update',
  parameters: z.object({
    condition: z.string(),
    updates: z.record(z.unknown())
  }),
  handler: async ({ condition, updates }, { network }) => {
    const state = network.state.data;
    
    // Conditional updates based on current state
    switch (condition) {
      case 'phase_complete':
        if (state.currentPhase !== 'complete') {
          state.completedPhases = [...(state.completedPhases || []), state.currentPhase];
          state.currentPhase = updates.nextPhase;
        }
        break;
        
      case 'error_recovery':
        state.errors = state.errors || [];
        state.errors.push(updates.errorInfo);
        state.recoveryAttempts = (state.recoveryAttempts || 0) + 1;
        break;
        
      case 'data_merge':
        state.collectedData = {
          ...state.collectedData,
          ...updates.newData
        };
        break;
    }
    
    return { updated: true, condition, timestamp: Date.now() };
  }
});
```

## State Persistence Strategies

### Database Integration

```typescript
interface PersistentState {
  sessionId: string;
  persistentData: unknown;
  temporaryData: unknown;
}

const saveToDatabaseTool = createTool({
  name: 'save_to_database',
  parameters: z.object({
    sessionId: z.string()
  }),
  handler: async ({ sessionId }, { network, step }) => {
    const state = network.state.data;
    
    return await step.run('save-state', async () => {
      // Save persistent data to database
      await database.saveWorkflowState(sessionId, {
        businessInfo: state.businessInfo,
        files: state.files,
        summary: state.summary,
        timestamp: Date.now()
      });
      
      return { saved: true, sessionId };
    });
  }
});
```

### State Serialization

```typescript
const serializeState = (state: any): string => {
  return JSON.stringify(state, (key, value) => {
    // Handle special types that don't serialize well
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    if (value instanceof Set) {
      return { __type: 'Set', value: Array.from(value) };
    }
    if (value instanceof Map) {
      return { __type: 'Map', value: Array.from(value.entries()) };
    }
    return value;
  });
};

const deserializeState = (serializedState: string): any => {
  return JSON.parse(serializedState, (key, value) => {
    if (value && typeof value === 'object' && value.__type) {
      switch (value.__type) {
        case 'Date':
          return new Date(value.value);
        case 'Set':
          return new Set(value.value);
        case 'Map':
          return new Map(value.value);
      }
    }
    return value;
  });
};
```

## Best Practices for Intuivox

### 1. Design Clear State Structure

Define comprehensive TypeScript interfaces:

```typescript
interface IntuivoxWorkflowState {
  // Identity and context
  projectId: string;
  userId: string;
  sessionId: string;
  
  // Workflow control
  phase: 'info_gathering' | 'code_generation' | 'review' | 'complete';
  startTime: number;
  lastUpdate: number;
  
  // Business context
  businessInfo: BusinessInfo;
  requirements: string[];
  
  // Technical assets
  sandbox: {
    id: string;
    url?: string;
    status: 'creating' | 'active' | 'expired';
  };
  files: { [path: string]: string };
  
  // Progress tracking
  completedSteps: string[];
  errors: ErrorInfo[];
  attempts: { [operation: string]: number };
  
  // Results
  summary: string;
  generatedAssets: GeneratedAsset[];
}
```

### 2. Initialize with Comprehensive Defaults

```typescript
const createDefaultState = (projectId: string): IntuivoxWorkflowState => ({
  projectId,
  userId: '',
  sessionId: generateSessionId(),
  
  phase: 'info_gathering',
  startTime: Date.now(),
  lastUpdate: Date.now(),
  
  businessInfo: {
    businessName: '',
    businessDescription: '',
    businessIndustry: '',
    businessSubIndustry: '',
    businessAddress: '',
    businessContactInfo: ''
  },
  requirements: [],
  
  sandbox: {
    id: '',
    status: 'creating'
  },
  files: {},
  
  completedSteps: [],
  errors: [],
  attempts: {},
  
  summary: '',
  generatedAssets: []
});
```

### 3. Implement State Validation

```typescript
const validateIntuivoxState = (state: any): state is IntuivoxWorkflowState => {
  const required = [
    'projectId', 'phase', 'businessInfo', 'sandbox', 'files'
  ];
  
  return required.every(field => state[field] !== undefined) &&
    typeof state.projectId === 'string' &&
    ['info_gathering', 'code_generation', 'review', 'complete'].includes(state.phase) &&
    typeof state.businessInfo === 'object' &&
    typeof state.files === 'object';
};
```

### 4. Atomic State Updates

```typescript
const updateBusinessInfo = (
  network: Network<IntuivoxWorkflowState>,
  updates: Partial<BusinessInfo>
) => {
  const state = network.state.data;
  
  // Atomic update with validation
  const newBusinessInfo = {
    ...state.businessInfo,
    ...updates
  };
  
  // Validate before applying
  if (isValidBusinessInfo(newBusinessInfo)) {
    state.businessInfo = newBusinessInfo;
    state.lastUpdate = Date.now();
    state.completedSteps.push('business_info_updated');
  } else {
    throw new Error('Invalid business info update');
  }
};
```

### 5. State-Driven Error Recovery

```typescript
const handleStateError = (
  network: Network<IntuivoxWorkflowState>,
  error: Error,
  context: string
) => {
  const state = network.state.data;
  
  // Record error
  state.errors.push({
    message: error.message,
    context,
    timestamp: Date.now(),
    phase: state.phase
  });
  
  // Update attempt counters
  state.attempts[context] = (state.attempts[context] || 0) + 1;
  
  // Determine recovery strategy based on state
  if (state.attempts[context] > 3) {
    state.phase = 'complete';
    state.summary = 'Workflow terminated due to repeated errors';
  } else if (error.message.includes('sandbox')) {
    // Reset sandbox state for retry
    state.sandbox.status = 'creating';
    state.sandbox.id = '';
  }
};
```

## Performance Optimization

### Memory Management

```typescript
const cleanupState = (network: Network<IntuivoxWorkflowState>) => {
  const state = network.state.data;
  
  // Clean up large temporary data
  if (state.phase === 'complete') {
    // Keep only essential data
    delete state.temporaryFiles;
    delete state.intermediateResults;
    
    // Limit error history
    if (state.errors.length > 10) {
      state.errors = state.errors.slice(-5);
    }
  }
  
  // Compress file storage
  if (Object.keys(state.files).length > 50) {
    console.warn('Large file count detected, consider cleanup');
  }
};
```

### State Size Monitoring

```typescript
const monitorStateSize = (network: Network<any>) => {
  const stateSize = JSON.stringify(network.state).length;
  const messageSizeKB = Math.round(stateSize / 1024);
  
  if (messageSizeKB > 100) {
    console.warn(`Large state detected: ${messageSizeKB}KB`);
    
    // Implement cleanup or compression
    if (messageSizeKB > 500) {
      console.error('State size critical, implementing cleanup');
      cleanupState(network);
    }
  }
};
```

## Debugging and Monitoring

### State Inspection Tools

```typescript
const inspectState = (network: Network<any>, context: string) => {
  const state = network.state.data;
  
  console.log(`State inspection [${context}]:`, {
    timestamp: Date.now(),
    phase: state.phase,
    messageCount: network.state.messages.length,
    stateKeys: Object.keys(state),
    stateSize: JSON.stringify(state).length,
    businessInfoComplete: isBusinessInfoComplete(state.businessInfo),
    fileCount: Object.keys(state.files || {}).length
  });
};

// Usage in router
router: ({ network }) => {
  inspectState(network, 'router-call');
  return selectAgent(network.state.data);
}
```

### State Change Tracking

```typescript
const trackStateChanges = (
  before: any,
  after: any,
  context: string
) => {
  const changes = [];
  
  const compareObjects = (obj1: any, obj2: any, path = '') => {
    for (const key in obj2) {
      const newPath = path ? `${path}.${key}` : key;
      
      if (obj1[key] !== obj2[key]) {
        changes.push({
          path: newPath,
          before: obj1[key],
          after: obj2[key]
        });
      }
    }
  };
  
  compareObjects(before, after);
  
  if (changes.length > 0) {
    console.log(`State changes in ${context}:`, changes);
  }
};
```

This comprehensive State reference provides everything needed to understand, implement, and optimize state management in Intuivox's multi-agent workflows, with specific focus on your business information gathering and code generation coordination patterns.