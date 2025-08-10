# AgentKit Agents - Implementation Reference for Intuivox

## Overview

Agents in AgentKit are **stateless entities with defined goals** that serve as intelligent wrappers around AI models. They form the fundamental building blocks of AgentKit and can be equipped with tools to extend their capabilities beyond text generation.

## Core Characteristics

- **Stateless Design**: Agents maintain no persistent memory between runs
- **Goal-Oriented**: Each agent has a specific, well-defined purpose
- **Model-Agnostic**: Can wrap any supported AI model (OpenAI, Anthropic, etc.)
- **Tool-Enabled**: Optional tools extend functionality for system interactions
- **Composable**: Can work individually or within Networks for collaborative workflows

## Agent Creation Requirements

### Essential Components

Every agent requires these three core elements:

1. **Name** - Unique identifier for the agent
2. **System Prompt** - Instructions defining role, behavior, and constraints
3. **Model** - The underlying AI model configuration

### Optional Components

- **Description** - Required when using agent in Networks
- **Tools** - Array of tools to extend agent capabilities
- **Lifecycle Hooks** - Custom logic for different execution phases

## Basic Agent Creation

```typescript
import { createAgent, openai } from "@inngest/agent-kit";

const codeWriterAgent = createAgent({
  name: 'Code writer',
  system: 'You are an expert TypeScript programmer specialized in Next.js applications...',
  model: openai('gpt-4o-mini'),
});
```

## Advanced Agent Configuration

### With Tools and Lifecycle Hooks

```typescript
const businessInfoAgent = createAgent({
  name: 'business-info-gatherer',
  description: 'Collects business information through conversation',
  system: BUSINESS_INFO_GATHERER_PROMPT,
  model: openai({ model: 'gpt-4o' }),
  tools: [askUserQuestionTool],
  lifecycle: {
    onStart: async ({ prompt, network }) => {
      // Dynamically modify prompts based on network state
      const businessInfo = network?.state?.data?.businessInfo;
      if (businessInfo?.businessName) {
        return {
          ...prompt,
          system: prompt.system + `\nBusiness context: ${businessInfo.businessName}`
        };
      }
      return prompt;
    },
    onResponse: async ({ result, network }) => {
      // Parse and store business information from response
      const lastMessage = result.output[result.output.length - 1];
      if (lastMessage?.type === 'text' && lastMessage.content.includes('<business_info>')) {
        // Extract and store business info in network state
        const businessInfoMatch = lastMessage.content.match(
          /<business_info>([\s\S]*?)<\/business_info>/
        );
        if (businessInfoMatch && network) {
          try {
            const parsedInfo = JSON.parse(businessInfoMatch[1]);
            network.state.data.businessInfo = {
              ...network.state.data.businessInfo,
              ...parsedInfo
            };
          } catch (error) {
            console.log('Failed to parse business info:', error);
          }
        }
      }
      return result;
    },
    onFinish: async ({ result, toolCalls }) => {
      // Inspect tool execution results
      console.log('Agent completed with tool calls:', toolCalls?.length || 0);
      return result;
    }
  }
});
```

## Execution Model

When an agent's `run()` method is called:

1. **Prompt Preparation**: System prompt + user input are prepared
2. **Lifecycle Hook - onStart**: Optional prompt modification
3. **Model Inference**: AI model processes the prepared prompts
4. **Tool Execution**: If model requests tools, they're executed sequentially
5. **Lifecycle Hook - onResponse**: Optional response processing
6. **Lifecycle Hook - onFinish**: Optional final inspection
7. **Result Return**: Structured result with output and metadata

## Lifecycle Hooks Deep Dive

### onStart Hook
- **Purpose**: Dynamically modify prompts before inference
- **Use Cases**: Context injection, prompt personalization, conditional instructions
- **Parameters**: `{ prompt, input, network, agent }`
- **Return**: Modified prompt object or original prompt

```typescript
onStart: async ({ prompt, network }) => {
  const context = network?.state?.data?.context;
  return {
    ...prompt,
    system: `${prompt.system}\n\nAdditional context: ${context}`
  };
}
```

### onResponse Hook  
- **Purpose**: Process and modify model responses
- **Use Cases**: Data extraction, state updates, response transformation
- **Parameters**: `{ result, network, agent }`
- **Return**: Modified result or original result

```typescript
onResponse: async ({ result, network }) => {
  // Extract structured data from response
  const lastMessage = result.output[result.output.length - 1];
  if (lastMessage?.content?.includes('<summary>')) {
    const summary = extractSummary(lastMessage.content);
    network.state.data.summary = summary;
  }
  return result;
}
```

### onFinish Hook
- **Purpose**: Inspect final results and tool executions
- **Use Cases**: Logging, metrics, cleanup, validation
- **Parameters**: `{ result, toolCalls, network, agent }`
- **Return**: Modified result or original result

```typescript
onFinish: async ({ result, toolCalls }) => {
  console.log(`Agent completed with ${toolCalls?.length || 0} tool calls`);
  // Log to analytics, cleanup resources, etc.
  return result;
}
```

## Network Integration

When using agents in Networks, additional requirements apply:

### Description Requirement
```typescript
const networkAgent = createAgent({
  name: 'code-agent',
  description: 'Generates Next.js applications in sandbox environments', // Required for networks
  system: PROMPT,
  model: openai({ model: 'gpt-4.1' }),
  tools: [terminalTool, fileSystemTool]
});
```

### State Access
Agents in networks can access shared state through lifecycle hooks:

```typescript
lifecycle: {
  onStart: async ({ network }) => {
    const sharedData = network?.state?.data;
    // Use shared state to influence behavior
  }
}
```

## Model Configuration

### OpenAI Models
```typescript
// Simple configuration
model: openai('gpt-4o-mini')

// Advanced configuration
model: openai({
  model: 'gpt-4.1',
  defaultParameters: {
    temperature: 0.1,
    max_tokens: 2000,
    top_p: 0.9
  }
})
```

### Other Providers
AgentKit supports multiple AI providers. Configure based on your needs:

```typescript
// Anthropic Claude
model: anthropic('claude-3-sonnet')

// Custom provider configuration
model: customProvider({
  apiKey: process.env.CUSTOM_API_KEY,
  model: 'custom-model-name'
})
```

## Best Practices for Intuivox

### 1. Clear System Prompts
Write specific, detailed system prompts that:
- Define the agent's role clearly
- Specify expected output formats
- Include relevant constraints and guidelines
- Reference business context when applicable

### 2. Stateless Design
Remember agents are stateless:
- Use network state for persistence
- Don't rely on instance variables
- Design for parallel execution

### 3. Tool Integration
Equip agents with relevant tools:
- Keep tools focused and specific
- Use strong typing with Zod schemas
- Handle errors gracefully in tool handlers

### 4. Lifecycle Hook Usage
Leverage lifecycle hooks for:
- Dynamic prompt injection
- State management
- Data extraction and transformation
- Logging and monitoring

### 5. Network Coordination
When using multiple agents:
- Provide clear descriptions for routing logic
- Design complementary capabilities
- Share state effectively through network context

## Current Intuivox Implementation

### Business Info Gatherer Agent
```typescript
const businessInfoGathererAgent = createAgent<AgentState>({
  name: "business-info-gatherer-agent",
  description: "An expert business info gatherer agent",
  system: BUSINESS_INFO_GATHERER_PROMPT,
  model: openai({ model: "gpt-4o" }),
  tools: [askUserQuestionTool],
  lifecycle: {
    onResponse: async ({ result, network }) => {
      // Extracts business info from structured tags
      // Updates network state with collected information
    }
  }
});
```

### Code Generation Agent
```typescript
const codeAgent = createAgent<AgentState>({
  name: "code-agent",
  description: "An expert coding agent",
  system: PROMPT,
  model: openai({
    model: "gpt-4.1",
    defaultParameters: { temperature: 0.1 }
  }),
  tools: [terminalTool, createOrUpdateFilesTool, readFilesTool],
  lifecycle: {
    onResponse: async ({ result, network }) => {
      // Extracts task summaries from responses
      // Updates file state in network
    }
  }
});
```

## Performance Considerations

- **Model Selection**: Choose appropriate model size for task complexity
- **Token Management**: Monitor prompt lengths and response sizes  
- **Parallel Execution**: Design for concurrent agent runs when possible
- **Error Handling**: Implement robust error handling in tools and lifecycle hooks

## Debugging and Monitoring

- Use lifecycle hooks for logging
- Monitor tool execution times
- Track state changes in network context
- Implement proper error reporting for failed agent runs

## Security Considerations

- Validate all inputs to agents
- Sanitize tool parameters
- Implement proper authentication for tool operations
- Monitor for potential prompt injection attempts
- Use environment variables for sensitive configuration