# AgentKit Deployment - Implementation Reference for Intuivox

## Overview

AgentKit deployment differs from traditional microservice deployments as it operates as a **library/framework integrated into existing applications** rather than a standalone service. It requires Inngest for execution orchestration and integrates seamlessly with modern web application architectures.

## Core Deployment Architecture

### Library-Based Architecture

AgentKit is fundamentally a TypeScript/JavaScript library that:
- Integrates directly into Node.js applications
- Requires no separate server infrastructure
- Leverages existing application deployment pipelines
- Depends on Inngest for function orchestration and reliability

### Integration Pattern

```typescript
// AgentKit integrates into existing applications
import { createAgent, createNetwork, inngest } from "@inngest/agent-kit";

// Agents are defined in your application code
const myAgent = createAgent({
  name: "app-agent",
  system: "You are an expert assistant",
  model: openai("gpt-4o")
});

// Inngest functions are registered with your app
export const agentFunction = inngest.createFunction(
  { id: "agent-execution" },
  { event: "agent/execute" },
  async ({ event }) => {
    return await myAgent.run(event.data.input);
  }
);
```

## Current Intuivox Deployment

### Next.js Integration

Intuivox already demonstrates the recommended deployment pattern:

```typescript
// src/app/api/inngest/route.ts - Inngest endpoint
import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { codeAgentFunction, handleUserQuestion } from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    codeAgentFunction,        // Main agent workflow
    handleUserQuestion        // User interaction handler
  ],
});
```

### Inngest Client Configuration

```typescript
// src/inngest/client.ts
import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "intuivox",
  name: "Intuivox Agent System"
});
```

### Agent Functions

```typescript
// src/inngest/functions.ts - AgentKit integration
export const codeAgentFunction = inngest.createFunction(
  { id: "code-agent" },
  { event: "code-agent/run" },
  async ({ event, step }) => {
    // AgentKit network execution
    const result = await network.run(event.data.value, { state });
    
    // Integration with database
    await step.run("save-result", async () => {
      await prisma.message.create({
        data: {
          projectId: event.data.projectId,
          content: generateResponse(),
          role: "ASSISTANT",
          type: "RESULT"
        }
      });
    });
    
    return result;
  }
);
```

## Environment Configuration

### Required Environment Variables

```bash
# Inngest Configuration (Required)
INNGEST_EVENT_KEY=evt_your_event_key
INNGEST_SIGNING_KEY=signkey_your_signing_key

# AI Model Providers (At least one required)
OPENAI_API_KEY=sk-your_openai_key
ANTHROPIC_API_KEY=sk-ant-your_anthropic_key
GEMINI_API_KEY=your_gemini_key
XAI_API_KEY=your_grok_key

# Database (Application specific)
DATABASE_URL=postgresql://...

# Authentication (Application specific) 
CLERK_SECRET_KEY=sk_your_clerk_key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_your_clerk_key

# E2B Sandbox (Intuivox specific)
E2B_API_KEY=your_e2b_key
```

### Development vs Production Configuration

```typescript
// Development configuration
const isDevelopment = process.env.NODE_ENV === 'development';

const inngestConfig = {
  id: "intuivox",
  name: "Intuivox Agent System",
  // Development uses local Inngest dev server
  // Production uses Inngest Cloud automatically
  ...(isDevelopment && {
    eventKey: process.env.INNGEST_EVENT_KEY,
    signingKey: process.env.INNGEST_SIGNING_KEY
  })
};

export const inngest = new Inngest(inngestConfig);
```

## Deployment Platforms

### 1. Vercel (Recommended for Next.js)

Intuivox's current deployment platform - ideal for AgentKit integration:

```json
// vercel.json
{
  "functions": {
    "src/app/api/**/*.ts": {
      "maxDuration": 300
    }
  },
  "env": {
    "INNGEST_EVENT_KEY": "@inngest-event-key",
    "INNGEST_SIGNING_KEY": "@inngest-signing-key",
    "OPENAI_API_KEY": "@openai-api-key"
  }
}
```

**Benefits for AgentKit**:
- Automatic scaling for agent workloads
- Built-in Next.js optimization
- Edge network distribution
- Integrated monitoring and logging

### 2. Netlify

```toml
# netlify.toml
[build]
  command = "npm run build"
  functions = "netlify/functions"

[[redirects]]
  from = "/api/inngest/*"
  to = "/.netlify/functions/inngest/:splat"
  status = 200

[build.environment]
  INNGEST_EVENT_KEY = "evt_your_key"
  INNGEST_SIGNING_KEY = "signkey_your_key"
```

### 3. AWS Lambda with Serverless Framework

```yaml
# serverless.yml
service: intuivox-agents

provider:
  name: aws
  runtime: nodejs18.x
  timeout: 300  # 5 minutes for complex agent workflows
  
functions:
  inngest:
    handler: dist/api/inngest.handler
    events:
      - http:
          path: inngest/{proxy+}
          method: ANY
    environment:
      INNGEST_EVENT_KEY: ${env:INNGEST_EVENT_KEY}
      INNGEST_SIGNING_KEY: ${env:INNGEST_SIGNING_KEY}
      OPENAI_API_KEY: ${env:OPENAI_API_KEY}
```

### 4. Railway

```toml
# railway.toml  
[build]
  builder = "NIXPACKS"

[deploy]
  startCommand = "npm start"
  healthcheckPath = "/api/health"
  healthcheckTimeout = 300

[[services]]
  name = "intuivox-web"
  
  [services.variables]
  PORT = "3000"
  NODE_ENV = "production"
```

## Production Considerations

### 1. Performance Optimization

```typescript
// Optimize agent execution for production
const productionAgentConfig = {
  // Use faster models for non-critical tasks
  quickResponseModel: openai({
    model: "gpt-4o-mini",
    defaultParameters: {
      max_tokens: 500,
      temperature: 0.2
    }
  }),
  
  // Timeout configuration
  networkTimeout: 300000, // 5 minutes
  
  // Concurrency limits
  maxConcurrentAgents: 5,
  
  // Memory optimization
  maxStateSize: 1000000 // 1MB
};

// Production network with optimizations
const productionNetwork = createNetwork({
  agents: [businessAgent, codeAgent],
  maxIter: 20, // Prevent infinite loops
  router: optimizedRouter
});
```

### 2. Error Handling and Resilience

```typescript
// Production-grade error handling
export const resilientAgentFunction = inngest.createFunction(
  { 
    id: "resilient-agent",
    retries: 3,
    concurrency: { limit: 10 }
  },
  { event: "agent/execute" },
  async ({ event, step }) => {
    try {
      // Wrap agent execution in error handling
      return await step.run("agent-execution", async () => {
        const result = await network.run(event.data.input, {
          state: event.data.state,
          timeout: 300000 // 5 minute timeout
        });
        
        return result;
      });
    } catch (error) {
      // Log error for monitoring
      await step.run("log-error", async () => {
        console.error("Agent execution failed:", {
          error: error.message,
          stack: error.stack,
          input: event.data.input,
          timestamp: new Date().toISOString()
        });
      });
      
      // Return graceful failure response
      return {
        success: false,
        error: "Agent execution failed",
        fallback: "Please try again or contact support"
      };
    }
  }
);
```

### 3. Resource Management

```typescript
// Resource limits and monitoring
const resourceManager = {
  // Monitor memory usage
  checkMemoryUsage: () => {
    const used = process.memoryUsage();
    const usedMB = Math.round(used.heapUsed / 1024 / 1024 * 100) / 100;
    
    if (usedMB > 500) { // 500MB threshold
      console.warn(`High memory usage: ${usedMB}MB`);
    }
    
    return usedMB;
  },
  
  // Cleanup large state objects
  cleanupState: (state: any) => {
    if (state.files && Object.keys(state.files).length > 100) {
      console.warn("Large file state detected, consider cleanup");
    }
    
    // Remove temporary data
    delete state.temporaryFiles;
    delete state.debugInfo;
    
    return state;
  },
  
  // Rate limiting
  rateLimiter: new Map<string, { count: number; resetTime: number }>(),
  
  checkRateLimit: (userId: string, limit = 10, window = 60000) => {
    const now = Date.now();
    const userLimits = resourceManager.rateLimiter.get(userId);
    
    if (!userLimits || now > userLimits.resetTime) {
      resourceManager.rateLimiter.set(userId, {
        count: 1,
        resetTime: now + window
      });
      return true;
    }
    
    if (userLimits.count >= limit) {
      return false;
    }
    
    userLimits.count++;
    return true;
  }
};
```

## Monitoring and Observability

### 1. Inngest Monitoring

```typescript
// Enhanced function with monitoring
export const monitoredAgentFunction = inngest.createFunction(
  { 
    id: "monitored-agent",
    onFailure: async ({ event, error }) => {
      // Custom failure handling
      console.error("Function failed:", {
        functionId: event.name,
        error: error.message,
        data: event.data
      });
      
      // Send to monitoring service
      await sendToMonitoringService({
        type: "function_failure",
        functionId: event.name,
        error: error.message,
        timestamp: Date.now()
      });
    }
  },
  { event: "agent/execute" },
  async ({ event, step }) => {
    const startTime = Date.now();
    
    // Track execution metrics
    await step.run("track-start", async () => {
      await trackMetric("agent.execution.started", 1, {
        agentType: event.data.agentType,
        userId: event.data.userId
      });
    });
    
    try {
      const result = await network.run(event.data.input);
      
      // Track success metrics
      await step.run("track-success", async () => {
        const duration = Date.now() - startTime;
        await trackMetric("agent.execution.completed", duration, {
          agentType: event.data.agentType,
          success: true
        });
      });
      
      return result;
    } catch (error) {
      // Track failure metrics
      await step.run("track-failure", async () => {
        const duration = Date.now() - startTime;
        await trackMetric("agent.execution.failed", duration, {
          agentType: event.data.agentType,
          error: error.message
        });
      });
      
      throw error;
    }
  }
);
```

### 2. Application Performance Monitoring

```typescript
// APM integration
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Initialize OpenTelemetry for production
if (process.env.NODE_ENV === 'production') {
  const sdk = new NodeSDK({
    instrumentations: [getNodeAutoInstrumentations()],
    serviceName: 'intuivox-agents',
    serviceVersion: process.env.npm_package_version
  });
  
  sdk.start();
}

// Custom metrics for agent performance
export const agentMetrics = {
  executionTime: new Map<string, number>(),
  errorCounts: new Map<string, number>(),
  
  trackExecution: (agentName: string, duration: number, success: boolean) => {
    // Track execution time
    const current = agentMetrics.executionTime.get(agentName) || 0;
    agentMetrics.executionTime.set(agentName, current + duration);
    
    // Track errors
    if (!success) {
      const errors = agentMetrics.errorCounts.get(agentName) || 0;
      agentMetrics.errorCounts.set(agentName, errors + 1);
    }
  },
  
  getStats: () => ({
    executionTimes: Object.fromEntries(agentMetrics.executionTime),
    errorCounts: Object.fromEntries(agentMetrics.errorCounts)
  })
};
```

## Security Considerations

### 1. Environment Variable Security

```typescript
// Secure environment configuration
const validateEnvironment = () => {
  const requiredSecrets = [
    'INNGEST_SIGNING_KEY',
    'OPENAI_API_KEY',
    'DATABASE_URL'
  ];
  
  const missing = requiredSecrets.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Validate key formats
  if (!process.env.INNGEST_SIGNING_KEY?.startsWith('signkey_')) {
    throw new Error('Invalid INNGEST_SIGNING_KEY format');
  }
  
  if (!process.env.OPENAI_API_KEY?.startsWith('sk-')) {
    throw new Error('Invalid OPENAI_API_KEY format');
  }
};

// Call during application startup
validateEnvironment();
```

### 2. Input Validation and Sanitization

```typescript
// Secure agent input handling
const secureAgentExecution = async (input: unknown, userId: string) => {
  // Validate input
  if (typeof input !== 'string' || input.length > 10000) {
    throw new Error('Invalid input format or size');
  }
  
  // Sanitize input
  const sanitizedInput = input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
  
  // Rate limiting
  if (!resourceManager.checkRateLimit(userId, 10, 60000)) {
    throw new Error('Rate limit exceeded');
  }
  
  return sanitizedInput;
};
```

## Scaling Strategies

### 1. Horizontal Scaling

```typescript
// Load balancing configuration
const scalingConfig = {
  // Inngest concurrency controls
  maxConcurrentFunctions: 50,
  
  // Agent-specific limits
  agentLimits: {
    'business-info-gatherer': 10,
    'code-agent': 5, // More resource intensive
    'fragment-title-generator': 20
  },
  
  // Queue management
  queueConfig: {
    maxQueueSize: 1000,
    priorityLevels: ['high', 'normal', 'low']
  }
};

// Priority-based execution
export const priorityAgentFunction = inngest.createFunction(
  {
    id: "priority-agent",
    concurrency: {
      limit: scalingConfig.agentLimits['code-agent'],
      key: 'event.data.agentType'
    }
  },
  { event: "agent/execute" },
  async ({ event, step }) => {
    const priority = event.data.priority || 'normal';
    
    // Handle high-priority requests faster
    if (priority === 'high') {
      return await executeWithHighPriority(event.data);
    }
    
    return await executeNormalPriority(event.data);
  }
);
```

### 2. Vertical Scaling

```typescript
// Resource allocation based on task complexity
const getResourceAllocation = (taskType: string) => {
  const allocations = {
    'simple': {
      memory: '256MB',
      timeout: 30000,
      model: 'gpt-4o-mini'
    },
    'complex': {
      memory: '1GB',
      timeout: 300000,
      model: 'gpt-4o'
    },
    'enterprise': {
      memory: '2GB',
      timeout: 600000,
      model: 'claude-3-5-sonnet-latest'
    }
  };
  
  return allocations[taskType] || allocations['simple'];
};
```

## Deployment Automation

### 1. CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy Intuivox Agents

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run tests
        run: npm test
        
      - name: Build application
        run: npm run build
        
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
          vercel-args: '--prod'
```

### 2. Environment Management

```bash
#!/bin/bash
# scripts/deploy.sh - Deployment script

set -e

echo "🚀 Deploying Intuivox Agents..."

# Validate environment
if [ -z "$VERCEL_TOKEN" ]; then
  echo "❌ VERCEL_TOKEN not set"
  exit 1
fi

# Run pre-deployment checks
npm run type-check
npm run lint
npm run test

# Deploy to staging first
echo "📤 Deploying to staging..."
vercel --token=$VERCEL_TOKEN

# Run integration tests against staging
npm run test:integration

# Promote to production
echo "🎯 Promoting to production..."
vercel --prod --token=$VERCEL_TOKEN

echo "✅ Deployment complete!"
```

## Best Practices for Intuivox

### 1. Production Deployment Checklist

```typescript
// Production readiness checklist
const productionChecklist = {
  environment: {
    allSecretsConfigured: () => validateEnvironment(),
    databaseConnected: () => checkDatabaseConnection(),
    inngestConfigured: () => checkInngestConnection()
  },
  
  performance: {
    timeoutsConfigured: () => checkTimeouts(),
    concurrencyLimitsSet: () => checkConcurrencyLimits(),
    memoryLimitsSet: () => checkMemoryLimits()
  },
  
  monitoring: {
    errorTrackingEnabled: () => checkErrorTracking(),
    metricsCollectionEnabled: () => checkMetrics(),
    alertsConfigured: () => checkAlerts()
  },
  
  security: {
    inputValidationEnabled: () => checkInputValidation(),
    rateLimitingEnabled: () => checkRateLimiting(),
    secretsSecured: () => checkSecretSecurity()
  }
};
```

### 2. Deployment Strategy

```typescript
// Blue-green deployment for agents
const deploymentStrategy = {
  // Gradual rollout
  canaryDeployment: {
    initialTraffic: 5,  // 5% of traffic to new version
    rampUpDuration: '1h',
    fullRolloutDuration: '24h'
  },
  
  // Rollback strategy
  rollbackTriggers: [
    'error_rate > 5%',
    'response_time > 30s',
    'success_rate < 95%'
  ],
  
  // Health checks
  healthChecks: [
    '/api/health',
    '/api/inngest/health'
  ]
};
```

This comprehensive Deployment reference provides everything needed to understand, implement, and optimize AgentKit deployment in production environments, with specific focus on Intuivox's Next.js architecture and requirements.