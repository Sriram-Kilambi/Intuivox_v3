# AgentKit Models - Implementation Reference for Intuivox

## Overview

Models in AgentKit are the **AI language models that power agent reasoning and responses**. AgentKit supports multiple model providers and allows flexible configuration of model parameters, enabling agents to use the most appropriate model for their specific tasks.

## Supported Model Providers

AgentKit currently supports four major AI model providers:

### 1. OpenAI
- **Environment Variable**: `OPENAI_API_KEY`
- **Import**: `import { openai } from "@inngest/agent-kit"`
- **Strengths**: Strong reasoning, function calling, wide model selection
- **Best For**: General-purpose agents, complex reasoning tasks, tool usage

### 2. Anthropic (Claude)
- **Environment Variable**: `ANTHROPIC_API_KEY`
- **Import**: `import { anthropic } from "@inngest/agent-kit"`
- **Strengths**: Large context windows, strong instruction following, safety
- **Best For**: Long conversations, detailed analysis, content generation

### 3. Google Gemini
- **Environment Variable**: `GEMINI_API_KEY`
- **Import**: `import { gemini } from "@inngest/agent-kit"`
- **Strengths**: Multimodal capabilities, fast inference
- **Best For**: Image analysis, fast responses, cost-effective solutions

### 4. xAI Grok
- **Environment Variable**: `XAI_API_KEY`
- **Import**: `import { grok } from "@inngest/agent-kit"`
- **Strengths**: Real-time information, uncensored responses
- **Best For**: Current events, creative tasks, unrestricted content

## Model Configuration

### Basic Model Setup

```typescript
import { openai, anthropic, gemini, grok } from "@inngest/agent-kit";

// Simple model configuration
const simpleModel = openai("gpt-4o");

// With specific version
const specificModel = openai("gpt-4o-mini");

// Different providers
const claudeModel = anthropic("claude-3-5-sonnet-latest");
const geminiModel = gemini("gemini-1.5-pro");
const grokModel = grok("grok-beta");
```

### Advanced Model Configuration

```typescript
// OpenAI with custom parameters
const openaiConfig = openai({
  model: "gpt-4o",
  defaultParameters: {
    temperature: 0.1,        // Lower temperature for consistent code generation
    max_tokens: 4000,        // Limit response length
    top_p: 0.9,             // Nucleus sampling
    frequency_penalty: 0.0,  // Repetition control
    presence_penalty: 0.0    // Topic diversity
  }
});

// Anthropic with required parameters
const anthropicConfig = anthropic({
  model: "claude-3-5-sonnet-latest",
  defaultParameters: {
    max_tokens: 4000,       // Required for Anthropic
    temperature: 0.1,
    top_p: 0.9
  }
});

// Gemini configuration
const geminiConfig = gemini({
  model: "gemini-1.5-pro",
  defaultParameters: {
    temperature: 0.2,
    max_output_tokens: 2048,
    top_p: 0.8,
    top_k: 40
  }
});
```

## Available Models

### OpenAI Models

```typescript
// GPT-4 family (highest capability)
const gpt4Turbo = openai("gpt-4-turbo");           // Latest GPT-4 Turbo
const gpt4o = openai("gpt-4o");                    // GPT-4o (optimized)
const gpt4oMini = openai("gpt-4o-mini");           // Faster, cost-effective
const gpt4 = openai("gpt-4");                      // Original GPT-4

// GPT-3.5 family (cost-effective)
const gpt35Turbo = openai("gpt-3.5-turbo");        // Most cost-effective

// Preview/experimental models
const gpt45Preview = openai("gpt-4.5-preview");    // Latest preview features
```

### Anthropic Models

```typescript
// Claude 3.5 family (latest generation)
const claude35Sonnet = anthropic("claude-3-5-sonnet-latest");
const claude35Haiku = anthropic("claude-3-5-haiku-latest");

// Claude 3 family
const claude3Opus = anthropic("claude-3-opus-latest");
const claude3Sonnet = anthropic("claude-3-sonnet-latest");
const claude3Haiku = anthropic("claude-3-haiku-latest");
```

### Model Selection Strategy

```typescript
// Task-specific model selection
const getModelForTask = (taskType: string, priority: 'speed' | 'quality' | 'cost') => {
  switch (taskType) {
    case 'code_generation':
      if (priority === 'quality') return openai("gpt-4o");
      if (priority === 'speed') return openai("gpt-4o-mini");
      return openai("gpt-3.5-turbo"); // cost
      
    case 'business_conversation':
      if (priority === 'quality') return anthropic("claude-3-5-sonnet-latest");
      return openai("gpt-4o-mini");
      
    case 'content_analysis':
      return gemini("gemini-1.5-pro");
      
    case 'creative_writing':
      return grok("grok-beta");
      
    default:
      return openai("gpt-4o-mini");
  }
};
```

## Current Intuivox Model Usage

### Business Info Gatherer Agent

```typescript
const businessInfoGathererAgent = createAgent<AgentState>({
  name: "business-info-gatherer-agent",
  description: "An expert business info gatherer agent",
  system: BUSINESS_INFO_GATHERER_PROMPT,
  model: openai({
    model: "gpt-4o",        // High-quality model for conversation
    defaultParameters: {
      temperature: 0.3,      // Consistent but natural responses
      max_tokens: 1500       // Reasonable response length
    }
  }),
  tools: [askUserQuestionTool]
});
```

### Code Generation Agent

```typescript
const codeAgent = createAgent<AgentState>({
  name: "code-agent",
  description: "An expert coding agent",
  system: PROMPT,
  model: openai({
    model: "gpt-4.1",           // Note: This appears to be a typo in original code
    defaultParameters: {
      temperature: 0.1,         // Very low for consistent code generation
      max_tokens: 4000          // Longer responses for code
    }
  }),
  tools: [terminalTool, createOrUpdateFilesTool, readFilesTool]
});
```

### Support Agents

```typescript
// Fragment title generator
const fragmentTitleGenerator = createAgent({
  name: "fragment-title-generator",
  description: "An expert fragment title generator agent",
  system: FRAGMENT_TITLE_PROMPT,
  model: openai({
    model: "gpt-4o",
    defaultParameters: {
      temperature: 0.2,     // Some creativity for titles
      max_tokens: 50        // Very short responses
    }
  })
});

// Response generator
const responseGenerator = createAgent({
  name: "response-generator", 
  description: "An expert response generator agent",
  system: RESPONSE_PROMPT,
  model: openai({
    model: "gpt-4o",
    defaultParameters: {
      temperature: 0.4,     // More creativity for user-facing responses
      max_tokens: 200       // Short, friendly responses
    }
  })
});
```

## Parameter Configuration Deep Dive

### Temperature Settings

```typescript
// Temperature guidelines for different use cases
const temperatureByUseCase = {
  code_generation: 0.1,      // Very deterministic
  business_logic: 0.2,       // Mostly consistent
  conversation: 0.3,         // Natural but consistent
  creative_content: 0.7,     // More creative
  brainstorming: 0.9         // Highly creative
};

// Example usage
const codeModel = openai({
  model: "gpt-4o",
  defaultParameters: {
    temperature: temperatureByUseCase.code_generation
  }
});
```

### Max Tokens Strategy

```typescript
// Token limits based on response type
const maxTokensByResponseType = {
  short_answer: 150,         // Quick responses
  explanation: 500,          // Detailed explanations  
  code_snippet: 1000,        // Code blocks
  full_implementation: 4000, // Complete implementations
  analysis: 2000            // Detailed analysis
};

// Dynamic token allocation
const getDynamicTokenLimit = (taskComplexity: 'simple' | 'medium' | 'complex') => {
  switch (taskComplexity) {
    case 'simple': return 500;
    case 'medium': return 1500;
    case 'complex': return 4000;
    default: return 1000;
  }
};
```

## Multi-Model Network Configuration

### Heterogeneous Model Networks

```typescript
const multiModelNetwork = createNetwork({
  name: "multi-model-workflow",
  agents: [
    // Fast model for initial processing
    createAgent({
      name: "preprocessor",
      model: openai("gpt-4o-mini"),
      system: "Quickly analyze and categorize the user request"
    }),
    
    // High-quality model for main work
    createAgent({
      name: "main-processor",
      model: openai("gpt-4o"),
      system: "Perform the main task with high quality"
    }),
    
    // Specialized model for specific tasks
    createAgent({
      name: "content-analyzer",
      model: gemini("gemini-1.5-pro"),
      system: "Analyze content with multimodal capabilities"
    })
  ],
  defaultModel: openai("gpt-4o-mini"), // Fallback model
  router: ({ network, callCount }) => {
    if (callCount === 0) return network.agents[0]; // preprocessor
    if (callCount === 1) return network.agents[1]; // main-processor  
    if (callCount === 2) return network.agents[2]; // content-analyzer
    return null;
  }
});
```

### Model Fallback Strategy

```typescript
const createResilientAgent = (taskType: string) => {
  const primaryModel = openai("gpt-4o");
  const fallbackModel = openai("gpt-4o-mini");
  const emergencyModel = openai("gpt-3.5-turbo");
  
  return createAgent({
    name: `resilient-${taskType}-agent`,
    system: `You are an expert ${taskType} agent`,
    model: primaryModel,
    lifecycle: {
      onStart: async ({ network }) => {
        // Track model usage
        network.state.data.modelAttempts = network.state.data.modelAttempts || {};
        network.state.data.modelAttempts.primary = 
          (network.state.data.modelAttempts.primary || 0) + 1;
      }
    }
  });
};

// Error handling with model fallback (conceptual - would need custom implementation)
const handleModelError = async (error: any, agent: any) => {
  if (error.message.includes('rate limit')) {
    // Switch to fallback model
    return createAgent({
      ...agent,
      model: openai("gpt-4o-mini")
    });
  }
  
  if (error.message.includes('token limit')) {
    // Use model with larger context
    return createAgent({
      ...agent,
      model: anthropic("claude-3-5-sonnet-latest")
    });
  }
  
  return agent;
};
```

## Cost Optimization Strategies

### Model Cost Hierarchy

```typescript
// Cost-effectiveness ranking (approximate)
const modelCostRanking = {
  most_economical: [
    "gpt-3.5-turbo",
    "gpt-4o-mini",
    "claude-3-haiku-latest"
  ],
  balanced: [
    "gpt-4o",
    "claude-3-5-sonnet-latest",
    "gemini-1.5-pro"
  ],
  premium: [
    "gpt-4-turbo",
    "claude-3-opus-latest"
  ]
};

// Cost-aware model selection
const selectCostEffectiveModel = (
  taskComplexity: 'simple' | 'medium' | 'complex',
  budget: 'low' | 'medium' | 'high'
) => {
  if (budget === 'low') {
    return taskComplexity === 'complex' 
      ? openai("gpt-4o-mini")
      : openai("gpt-3.5-turbo");
  }
  
  if (budget === 'medium') {
    return taskComplexity === 'simple'
      ? openai("gpt-4o-mini")
      : openai("gpt-4o");
  }
  
  // High budget
  return taskComplexity === 'complex'
    ? anthropic("claude-3-opus-latest")
    : openai("gpt-4o");
};
```

### Token Usage Optimization

```typescript
const optimizedModelConfig = (estimatedTokens: number) => {
  // Choose model based on expected token usage
  if (estimatedTokens < 500) {
    return openai({
      model: "gpt-4o-mini",
      defaultParameters: {
        max_tokens: 200,
        temperature: 0.3
      }
    });
  }
  
  if (estimatedTokens < 2000) {
    return openai({
      model: "gpt-4o",
      defaultParameters: {
        max_tokens: 1000,
        temperature: 0.2
      }
    });
  }
  
  // Large responses - use model with better context handling
  return anthropic({
    model: "claude-3-5-sonnet-latest",
    defaultParameters: {
      max_tokens: 4000,
      temperature: 0.2
    }
  });
};
```

## Performance Optimization

### Response Time Optimization

```typescript
// Speed-optimized model selection
const speedOptimizedModels = {
  fastest: openai("gpt-4o-mini"),
  fast: openai("gpt-4o"),
  balanced: anthropic("claude-3-5-haiku-latest"),
  quality: anthropic("claude-3-5-sonnet-latest")
};

// Parallel processing with different models
const parallelModelProcessing = async (input: string) => {
  const fastResponse = speedOptimizedModels.fastest.run(input);
  const qualityResponse = speedOptimizedModels.quality.run(input);
  
  // Return first response, but continue quality processing in background
  const firstResponse = await Promise.race([fastResponse, qualityResponse]);
  
  // Optional: Compare responses and learn from differences
  Promise.resolve(qualityResponse).then(qualityResult => {
    // Log or analyze quality differences
    compareResponses(firstResponse, qualityResult);
  });
  
  return firstResponse;
};
```

### Context Window Management

```typescript
// Context-aware model selection
const selectModelByContextSize = (contextTokens: number) => {
  if (contextTokens < 4000) {
    return openai("gpt-4o-mini");     // 16k context
  }
  
  if (contextTokens < 16000) {
    return openai("gpt-4o");          // 32k context
  }
  
  if (contextTokens < 32000) {
    return anthropic("claude-3-5-sonnet-latest"); // 200k context
  }
  
  // Very large context
  return anthropic("claude-3-opus-latest"); // 200k context
};
```

## Error Handling and Monitoring

### Model Error Management

```typescript
const robustModelConfiguration = (primaryModel: any, fallbackModel: any) => {
  return {
    primary: primaryModel,
    fallback: fallbackModel,
    
    async executeWithFallback(agent: any, input: string) {
      try {
        // Try primary model
        const result = await agent.run(input);
        return { result, modelUsed: 'primary' };
      } catch (primaryError) {
        console.warn('Primary model failed, trying fallback:', primaryError.message);
        
        try {
          // Switch to fallback model
          const fallbackAgent = { ...agent, model: fallbackModel };
          const result = await fallbackAgent.run(input);
          return { result, modelUsed: 'fallback' };
        } catch (fallbackError) {
          console.error('Both models failed:', {
            primary: primaryError.message,
            fallback: fallbackError.message
          });
          throw new Error('All model options exhausted');
        }
      }
    }
  };
};
```

### Model Performance Monitoring

```typescript
const modelPerformanceTracker = {
  metrics: new Map<string, {
    calls: number;
    totalTime: number;
    errors: number;
    tokenUsage: number;
  }>(),
  
  trackModelUsage(modelName: string, duration: number, tokens: number, error?: boolean) {
    const current = this.metrics.get(modelName) || {
      calls: 0,
      totalTime: 0,
      errors: 0,
      tokenUsage: 0
    };
    
    this.metrics.set(modelName, {
      calls: current.calls + 1,
      totalTime: current.totalTime + duration,
      errors: current.errors + (error ? 1 : 0),
      tokenUsage: current.tokenUsage + tokens
    });
  },
  
  getModelStats(modelName: string) {
    const stats = this.metrics.get(modelName);
    if (!stats) return null;
    
    return {
      averageResponseTime: stats.totalTime / stats.calls,
      errorRate: stats.errors / stats.calls,
      averageTokensPerCall: stats.tokenUsage / stats.calls,
      totalCalls: stats.calls
    };
  },
  
  getBestPerformingModel(metric: 'speed' | 'reliability' | 'efficiency') {
    let bestModel = '';
    let bestValue = metric === 'speed' ? Infinity : 0;
    
    for (const [modelName, stats] of this.metrics.entries()) {
      let value: number;
      
      switch (metric) {
        case 'speed':
          value = stats.totalTime / stats.calls;
          if (value < bestValue) {
            bestValue = value;
            bestModel = modelName;
          }
          break;
          
        case 'reliability':
          value = 1 - (stats.errors / stats.calls);
          if (value > bestValue) {
            bestValue = value;
            bestModel = modelName;
          }
          break;
          
        case 'efficiency':
          value = stats.calls / stats.tokenUsage; // calls per token
          if (value > bestValue) {
            bestValue = value;
            bestModel = modelName;
          }
          break;
      }
    }
    
    return { model: bestModel, score: bestValue };
  }
};
```

## Best Practices for Intuivox

### 1. Task-Appropriate Model Selection

```typescript
const intuivoxModelStrategy = {
  businessConversation: anthropic({
    model: "claude-3-5-sonnet-latest",
    defaultParameters: {
      max_tokens: 1500,
      temperature: 0.3
    }
  }),
  
  codeGeneration: openai({
    model: "gpt-4o", 
    defaultParameters: {
      temperature: 0.1,
      max_tokens: 4000
    }
  }),
  
  quickResponses: openai({
    model: "gpt-4o-mini",
    defaultParameters: {
      temperature: 0.2,
      max_tokens: 200
    }
  })
};
```

### 2. Cost-Quality Balance

```typescript
const getIntuivoxModel = (
  taskType: 'conversation' | 'code' | 'summary',
  userTier: 'free' | 'pro' | 'enterprise'
) => {
  const modelMatrix = {
    conversation: {
      free: openai("gpt-4o-mini"),
      pro: openai("gpt-4o"),
      enterprise: anthropic("claude-3-5-sonnet-latest")
    },
    code: {
      free: openai("gpt-3.5-turbo"),
      pro: openai("gpt-4o"),
      enterprise: openai("gpt-4o")
    },
    summary: {
      free: openai("gpt-4o-mini"),
      pro: openai("gpt-4o-mini"),
      enterprise: openai("gpt-4o")
    }
  };
  
  return modelMatrix[taskType][userTier];
};
```

### 3. Environment Configuration

```typescript
// Environment setup for Intuivox
const validateModelConfiguration = () => {
  const requiredKeys = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY'
  ];
  
  const missing = requiredKeys.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  console.log('All model provider API keys configured');
};

// Call during application startup
validateModelConfiguration();
```

This comprehensive Models reference provides everything needed to understand, configure, and optimize AI model usage in Intuivox's multi-agent workflows, enabling you to balance cost, performance, and quality based on specific task requirements and user tiers.