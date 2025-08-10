# AgentKit Routers - Implementation Reference for Intuivox

## Overview

Routers in AgentKit are **decision-making functions** that control the flow of multi-agent workflows. They determine which agent to execute next based on network state, previous results, and workflow logic, serving as the "brain" that coordinates agent collaboration.

## Core Purpose

Routers serve three critical functions:

1. **Agent Selection** - Decide which agent should execute next
2. **Workflow Control** - Manage the progression of multi-step tasks
3. **Termination Logic** - Determine when the network should complete

## Router Function Signature

```typescript
router: ({
  network,        // Full network instance with state access
  lastResult,     // Result from the previous agent execution
  callCount,      // Number of agents that have been executed
  input          // Original user input to the network
}) => Agent | null | undefined
```

### Return Values

- **Agent Instance** - Execute the selected agent next
- **`null` or `undefined`** - Terminate the network (workflow complete)

## Router Types and Patterns

### 1. Code-based Router (Supervised)

Deterministic routing with explicit programming logic - fastest and most predictable.

```typescript
const supervisedRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Sequential execution
  if (callCount === 0) return planningAgent;
  if (callCount === 1) return executionAgent;
  if (callCount === 2) return reviewAgent;
  
  return null; // Complete workflow
};
```

### 2. Routing Agent (Autonomous)

Uses LLM to make routing decisions - flexible but slower.

```typescript
const routingAgent = createAgent({
  name: 'router-agent',
  system: `You are a workflow router. Based on the current state, decide which agent should run next.
    Available agents: planning, research, code, review
    Return only the agent name or "COMPLETE" if done.`,
  model: openai('gpt-4o-mini')
});

const autonomousRouter = async ({ network, lastResult }) => {
  const state = network.state.data;
  
  const routerResult = await routingAgent.run(
    `Current state: ${JSON.stringify(state)}
     Last result: ${lastResult?.output?.[0]?.content}
     Which agent should run next?`
  );
  
  const decision = routerResult.output[0]?.content;
  
  switch (decision.toLowerCase()) {
    case 'planning': return planningAgent;
    case 'research': return researchAgent;
    case 'code': return codeAgent;
    case 'review': return reviewAgent;
    case 'complete': return null;
    default: return planningAgent;
  }
};
```

### 3. Hybrid Router (Semi-supervised)

Combines programmatic logic with LLM flexibility.

```typescript
const hybridRouter = async ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Hard-coded rules for critical decisions
  if (callCount === 0) return planningAgent;
  if (state.errors?.length > 3) return errorHandlingAgent;
  if (state.phase === 'complete') return null;
  
  // LLM routing for complex decisions
  if (state.phase === 'execution' && state.ambiguousContext) {
    return await getLLMRoutingDecision(network, lastResult);
  }
  
  // Default programmatic routing
  return getNextAgentByPhase(state.phase);
};
```

## Router Parameters Deep Dive

### Network Object

Provides access to complete network state and configuration:

```typescript
router: ({ network }) => {
  // Access network state
  const state = network.state.data;
  const messages = network.state.messages;
  
  // Access network configuration
  const networkName = network.name;
  const availableAgents = network.agents;
  
  return selectAgent(state);
}
```

### Last Result

Contains the output from the previous agent execution:

```typescript
router: ({ lastResult }) => {
  // Access agent output
  const lastOutput = lastResult?.output?.[0]?.content;
  const agentName = lastResult?.agentName;
  
  // Check for tool calls
  const toolCalls = lastResult?.toolCalls || [];
  const hasFileOperations = toolCalls.some(call => 
    call.toolName === 'createOrUpdateFiles'
  );
  
  // Check for errors
  if (lastResult?.error) {
    return errorRecoveryAgent;
  }
  
  // Route based on output content
  if (lastOutput?.includes('research_needed')) {
    return researchAgent;
  }
  
  return nextAgent;
}
```

### Call Count

Zero-based counter of agent executions:

```typescript
router: ({ callCount }) => {
  // Initial execution
  if (callCount === 0) return initialAgent;
  
  // Sequential phases
  if (callCount <= 2) return informationGatheringAgent;
  if (callCount <= 5) return executionAgent;
  
  // Safety valve
  if (callCount > 15) {
    console.warn('Maximum iterations reached');
    return null;
  }
  
  return continueWorkflowAgent;
}
```

### Input

Original user input that started the network:

```typescript
router: ({ input, callCount }) => {
  // Route based on original request
  if (input.toLowerCase().includes('urgent')) {
    return priorityAgent;
  }
  
  if (input.includes('website') && callCount === 0) {
    return websiteSpecialistAgent;
  }
  
  return generalAgent;
}
```

## Current Intuivox Router Implementation

### Multi-Agent Coordination Router

```typescript
router: async ({ network }) => {
  const summary = network.state.data.summary;
  
  // Completion condition - task is complete
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
```

This router demonstrates:
- **State-based routing** using business info completeness
- **Clear completion condition** when summary exists
- **Sequential workflow** from info gathering to code generation

## Advanced Router Patterns

### State Machine Router

```typescript
interface WorkflowState {
  phase: 'planning' | 'research' | 'execution' | 'review' | 'complete';
  subPhase?: string;
  attempts: { [key: string]: number };
}

const stateMachineRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data as WorkflowState;
  
  // State transitions based on current phase
  switch (state.phase) {
    case 'planning':
      if (state.subPhase === 'requirements_complete') {
        state.phase = 'research';
        return researchAgent;
      }
      return planningAgent;
      
    case 'research':
      const researchComplete = state.researchData?.length > 5;
      if (researchComplete) {
        state.phase = 'execution';
        return codeAgent;
      }
      // Limit research attempts
      if ((state.attempts.research || 0) > 3) {
        state.phase = 'execution';
        return codeAgent;
      }
      state.attempts.research = (state.attempts.research || 0) + 1;
      return researchAgent;
      
    case 'execution':
      if (state.generatedFiles && Object.keys(state.generatedFiles).length > 0) {
        state.phase = 'review';
        return reviewAgent;
      }
      return codeAgent;
      
    case 'review':
      if (state.reviewComplete) {
        state.phase = 'complete';
        return null;
      }
      return reviewAgent;
      
    case 'complete':
      return null;
      
    default:
      return planningAgent;
  }
};
```

### Conditional Branching Router

```typescript
const branchingRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Initial classification
  if (callCount === 0) return classifierAgent;
  
  // Branch based on classification result
  if (state.classification) {
    switch (state.classification) {
      case 'simple_website':
        return !state.simpleWebsiteComplete ? simpleWebsiteAgent : null;
        
      case 'complex_application':
        if (!state.architecturePlanned) return architectAgent;
        if (!state.backendComplete) return backendAgent;
        if (!state.frontendComplete) return frontendAgent;
        if (!state.integrated) return integrationAgent;
        return null;
        
      case 'data_analysis':
        if (!state.dataProcessed) return dataProcessingAgent;
        if (!state.analysisComplete) return analysisAgent;
        if (!state.visualizationReady) return visualizationAgent;
        return null;
        
      default:
        return generalPurposeAgent;
    }
  }
  
  // Fallback
  return classifierAgent;
};
```

### Error Recovery Router

```typescript
const errorRecoveryRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Track errors
  if (lastResult?.error) {
    state.errors = state.errors || [];
    state.errors.push({
      agent: lastResult.agentName,
      error: lastResult.error,
      callCount,
      timestamp: Date.now()
    });
  }
  
  // Error recovery strategies
  if (state.errors?.length > 0) {
    const recentErrors = state.errors.filter(e => 
      Date.now() - e.timestamp < 300000 // Last 5 minutes
    );
    
    // Too many recent errors
    if (recentErrors.length > 5) {
      console.error('Multiple errors detected, terminating workflow');
      return null;
    }
    
    // Specific error handling
    const lastError = state.errors[state.errors.length - 1];
    if (lastError.error.includes('sandbox')) {
      return sandboxRecoveryAgent;
    }
    if (lastError.error.includes('timeout')) {
      return retryAgent;
    }
    if (lastError.error.includes('validation')) {
      return validationRepairAgent;
    }
  }
  
  // Normal routing
  return normalRouter({ network, lastResult, callCount });
};
```

### Dynamic Agent Selection

```typescript
const dynamicRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Dynamically create agents based on state
  if (state.requiresSpecializedTool && !state.specializedAgentCreated) {
    const specializedAgent = createAgent({
      name: 'dynamic-specialized-agent',
      system: `You are specialized for: ${state.specializationRequirement}`,
      model: openai('gpt-4o'),
      tools: getSpecializedTools(state.requiresSpecializedTool)
    });
    
    state.specializedAgentCreated = true;
    return specializedAgent;
  }
  
  // Route to agents not in original network
  if (state.needsExternalIntegration) {
    return externalIntegrationAgent; // Not in network.agents
  }
  
  return standardRouting(network, state);
};
```

## Router Best Practices for Intuivox

### 1. Clear Termination Conditions

```typescript
const clearTerminationRouter = ({ network, callCount }) => {
  const state = network.state.data;
  
  // Multiple termination conditions
  if (state.summary && state.summary.length > 0) {
    return null; // Task complete
  }
  
  if (callCount > 20) {
    console.warn('Maximum iterations reached');
    state.summary = 'Workflow terminated due to iteration limit';
    return null;
  }
  
  if (state.errors?.length > 5) {
    console.error('Too many errors, terminating');
    state.summary = 'Workflow terminated due to errors';
    return null;
  }
  
  return continueWorkflow(state);
};
```

### 2. State Validation in Router

```typescript
const validatedRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Validate state structure
  if (!state || typeof state !== 'object') {
    console.error('Invalid state structure');
    return null;
  }
  
  // Validate required fields
  const requiredFields = ['projectId', 'phase', 'businessInfo'];
  const missingFields = requiredFields.filter(field => !state[field]);
  
  if (missingFields.length > 0) {
    console.error('Missing required state fields:', missingFields);
    return initializationAgent; // Repair state
  }
  
  // Validate business info completeness
  const businessInfo = state.businessInfo;
  const requiredBusinessFields = [
    'businessName', 'businessDescription', 'businessIndustry'
  ];
  
  const missingBusinessFields = requiredBusinessFields.filter(
    field => !businessInfo[field]
  );
  
  if (missingBusinessFields.length > 0) {
    return businessInfoGathererAgent;
  }
  
  return codeAgent;
};
```

### 3. Progress Tracking

```typescript
const progressTrackingRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Update progress tracking
  state.routerCalls = callCount;
  state.lastRouterCall = Date.now();
  
  // Track agent execution history
  if (lastResult) {
    state.agentHistory = state.agentHistory || [];
    state.agentHistory.push({
      agent: lastResult.agentName,
      timestamp: Date.now(),
      success: !lastResult.error,
      duration: lastResult.duration
    });
  }
  
  // Calculate progress percentage
  const totalSteps = 6; // Planning, info gathering, code gen, review, etc.
  const completedSteps = [
    state.planningComplete,
    state.businessInfoComplete,
    state.codeGenerationComplete,
    state.reviewComplete,
    state.deploymentReady,
    state.summary
  ].filter(Boolean).length;
  
  state.progressPercentage = (completedSteps / totalSteps) * 100;
  
  // Log progress
  if (callCount % 3 === 0) {
    console.log(`Workflow progress: ${state.progressPercentage.toFixed(1)}%`);
  }
  
  return selectNextAgent(state);
};
```

### 4. Context-Aware Routing

```typescript
const contextAwareRouter = ({ network, input, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Route based on original user intent
  const userIntent = analyzeUserIntent(input);
  
  if (userIntent.urgency === 'high' && callCount === 0) {
    return rapidPrototypeAgent;
  }
  
  if (userIntent.complexity === 'simple' && state.businessInfoComplete) {
    return simpleWebsiteAgent;
  }
  
  // Route based on previous agent output
  const lastOutput = lastResult?.output?.[0]?.content || '';
  
  if (lastOutput.includes('requires user input')) {
    return userInteractionAgent;
  }
  
  if (lastOutput.includes('technical research needed')) {
    return technicalResearchAgent;
  }
  
  // Route based on current context
  if (isBusinessHours() && state.needsReview) {
    return humanReviewAgent;
  }
  
  return defaultRouting(state);
};
```

## Performance Optimization

### Efficient Router Logic

```typescript
const optimizedRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Cache expensive operations
  if (!state.routerCache) {
    state.routerCache = {
      businessInfoComplete: isBusinessInfoComplete(state.businessInfo),
      codeGenerationReady: isCodeGenerationReady(state),
      reviewRequired: isReviewRequired(state)
    };
  }
  
  // Use cached values for routing decisions
  const cache = state.routerCache;
  
  if (!cache.businessInfoComplete) {
    return businessInfoGathererAgent;
  }
  
  if (cache.businessInfoComplete && !cache.codeGenerationReady) {
    return codePreparationAgent;
  }
  
  if (cache.codeGenerationReady && !state.codeComplete) {
    return codeAgent;
  }
  
  if (state.codeComplete && cache.reviewRequired) {
    return reviewAgent;
  }
  
  return null;
};
```

### Router Caching

```typescript
const cachedRouter = (() => {
  const routingCache = new Map();
  const cacheTimeout = 60000; // 1 minute
  
  return ({ network, lastResult, callCount }) => {
    const state = network.state.data;
    const cacheKey = JSON.stringify({
      phase: state.phase,
      businessComplete: !!state.businessInfoComplete,
      codeComplete: !!state.codeComplete,
      callCount
    });
    
    // Check cache
    const cached = routingCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cacheTimeout) {
      return cached.agent;
    }
    
    // Compute routing decision
    const selectedAgent = computeRoutingDecision(network, state);
    
    // Cache result
    routingCache.set(cacheKey, {
      agent: selectedAgent,
      timestamp: Date.now()
    });
    
    return selectedAgent;
  };
})();
```

## Debugging and Monitoring

### Router Logging

```typescript
const loggedRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  console.log(`Router Call ${callCount}:`, {
    timestamp: new Date().toISOString(),
    phase: state.phase,
    lastAgent: lastResult?.agentName,
    stateKeys: Object.keys(state),
    messageCount: network.state.messages.length
  });
  
  const selectedAgent = routingLogic(network, state);
  
  console.log(`Router Decision: ${selectedAgent?.name || 'TERMINATE'}`);
  
  return selectedAgent;
};
```

### Router Analytics

```typescript
const analyticsRouter = ({ network, lastResult, callCount }) => {
  const state = network.state.data;
  
  // Track routing patterns
  state.routingAnalytics = state.routingAnalytics || {
    decisions: [],
    agentUsage: {},
    averageRouterTime: 0
  };
  
  const startTime = Date.now();
  const selectedAgent = routingLogic(network, state);
  const routerTime = Date.now() - startTime;
  
  // Record analytics
  state.routingAnalytics.decisions.push({
    callCount,
    selectedAgent: selectedAgent?.name || 'TERMINATE',
    routerTime,
    stateSnapshot: JSON.stringify(state, null, 0).length
  });
  
  if (selectedAgent) {
    const usage = state.routingAnalytics.agentUsage;
    usage[selectedAgent.name] = (usage[selectedAgent.name] || 0) + 1;
  }
  
  // Calculate average router time
  const decisions = state.routingAnalytics.decisions;
  state.routingAnalytics.averageRouterTime = 
    decisions.reduce((sum, d) => sum + d.routerTime, 0) / decisions.length;
  
  return selectedAgent;
};
```

This comprehensive Routers reference provides everything needed to understand, implement, and optimize routing logic in Intuivox's multi-agent workflows, with specific focus on your business information gathering → code generation coordination and advanced patterns for workflow control.