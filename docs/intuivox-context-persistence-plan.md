# Intuivox Context Persistence Implementation Plan

## Problem Statement

### Current Issue
Intuivox's multi-agent system restarts the entire workflow from business information gathering even when users request simple changes to existing generated websites. This creates a poor user experience where users must re-answer business questions for every iteration.

### Current Flow (Problematic)
```
User Request → businessInfoGathererAgent → asks questions → codeAgent → generates website
User Change Request → businessInfoGathererAgent → asks questions AGAIN → codeAgent → regenerates
```

### Desired Flow
```
User Request → businessInfoGathererAgent → asks questions → codeAgent → generates website
User Change Request → codeAgent (directly) → modifies existing website
```

## Current System Analysis

### Existing Architecture
- **Database**: Prisma with PostgreSQL
  - `Project` model: Contains user projects
  - `Message` model: Stores conversation history with types (USER, ASSISTANT, AGENT_QUESTION)
  - `Fragment` model: Stores generated website artifacts (sandbox URL, files, title)

- **Multi-Agent System**: AgentKit with Inngest
  - `businessInfoGathererAgent`: Collects business information via conversation
  - `codeAgent`: Generates Next.js websites in E2B sandboxes
  - Router logic: Simple business info completeness check

- **State Management**: Session-based `AgentState`
  - No persistence between network runs
  - Business info and files stored temporarily during execution
  - No historical context awareness

### Root Cause Analysis
1. **No Conversation History Loading**: Each network run starts with empty context
2. **Naive Router Logic**: Router only checks current session business info completeness
3. **Missing Project State Detection**: System cannot differentiate between new projects and iterations
4. **No Code Continuity**: Previous generated files are not loaded into new sessions

## Solution Overview

Implement **AgentKit's History, State, and Memory concepts** to create context-aware multi-agent workflows that remember previous interactions and generated content.

### Key AgentKit Concepts to Leverage
1. **History Adapter**: Persist and load conversation context across runs
2. **Enhanced State**: Track project lifecycle and existing assets
3. **Intelligent Router**: Context-aware agent selection
4. **Memory Layer**: Learn user preferences and successful patterns

## Implementation Phases

---

## Phase 1: History Integration 🏗️

**Objective**: Implement AgentKit History Adapter to persist conversation context using existing database schema.

### Phase 1 Goals
- [x] **Problem Definition**: Document current issue and solution approach
- [ ] **History Adapter Implementation**: Create adapter using existing Prisma models
- [ ] **Network Integration**: Connect History Adapter to existing network
- [ ] **Testing**: Verify conversation persistence works
- [ ] **Validation**: Ensure no breaking changes to current functionality

### Phase 1 Detailed Tasks

#### Task 1.1: Create History Adapter Interface
**Estimated Time**: 2-3 hours
**Priority**: High
**Dependencies**: None

**Sub-tasks**:
- [ ] Create `src/inngest/history-adapter.ts`
- [ ] Implement `createThread` method using existing Project model
- [ ] Implement `get` method to load Messages as AgentResult format
- [ ] Implement `appendResults` method to save new agent responses
- [ ] Add utility functions for Message ↔ AgentResult conversion

**Code Structure**:
```typescript
// src/inngest/history-adapter.ts
interface IntuivoxHistoryAdapter extends HistoryConfig<AgentState> {
  createThread: (params) => Promise<{ threadId: string }>;
  get: (params) => Promise<AgentResult[]>;
  appendResults: (params) => Promise<void>;
}
```

#### Task 1.2: Message Format Conversion
**Estimated Time**: 2-3 hours
**Priority**: High
**Dependencies**: Task 1.1

**Sub-tasks**:
- [ ] Create `convertMessagesToAgentResults()` function
- [ ] Create `convertAgentResultsToMessages()` function
- [ ] Handle Fragment data in conversion (tool calls)
- [ ] Handle different message types (USER, ASSISTANT, AGENT_QUESTION)
- [ ] Add comprehensive error handling for malformed data

#### Task 1.3: Network History Integration
**Estimated Time**: 1-2 hours
**Priority**: High
**Dependencies**: Tasks 1.1, 1.2

**Sub-tasks**:
- [ ] Update network creation in `src/inngest/functions.ts`
- [ ] Add history adapter to network configuration
- [ ] Ensure backward compatibility with existing functionality
- [ ] Add logging for history operations

#### Task 1.4: Testing and Validation
**Estimated Time**: 3-4 hours
**Priority**: High
**Dependencies**: Tasks 1.1, 1.2, 1.3

**Sub-tasks**:
- [ ] Create unit tests for history adapter methods
- [ ] Test conversation loading from database
- [ ] Test new message saving functionality
- [ ] Integration test with existing workflow
- [ ] Performance test with large conversation histories
- [ ] Error handling tests (corrupt data, missing messages)

### Phase 1 Success Criteria
- [ ] Conversation history persists between network runs
- [ ] Previous messages load correctly at network start
- [ ] New agent responses save to database properly
- [ ] Existing functionality remains unbroken
- [ ] No performance degradation in message loading/saving
- [ ] All tests pass

### Phase 1 Risks and Mitigation
- **Risk**: Breaking existing message storage
  - **Mitigation**: Implement alongside existing system, feature flag for testing
- **Risk**: Performance issues with large conversations
  - **Mitigation**: Implement pagination and conversation summarization
- **Risk**: Data corruption during conversion
  - **Mitigation**: Comprehensive validation and error handling

---

## Phase 2: Router Intelligence 🧠

**Objective**: Enhance router logic to detect project state and route appropriately based on existing business info and generated code.

### Phase 2 Goals
- [ ] **Project State Detection**: Identify new vs. continuing projects
- [ ] **Intelligent Routing**: Skip business questions when info already exists
- [ ] **Change Request Handling**: Route modification requests directly to code agent
- [ ] **Backward Compatibility**: Maintain existing behavior for new projects

### Phase 2 Detailed Tasks

#### Task 2.1: Project State Detection Functions
**Estimated Time**: 2-3 hours
**Priority**: High
**Dependencies**: Phase 1 complete

**Sub-tasks**:
- [ ] Create `checkExistingBusinessInfo()` function
- [ ] Create `checkExistingCode()` function  
- [ ] Create `detectProjectPhase()` function
- [ ] Create `isChangeRequest()` function to analyze user input
- [ ] Add caching for expensive database lookups

#### Task 2.2: Enhanced Router Logic
**Estimated Time**: 3-4 hours
**Priority**: High
**Dependencies**: Task 2.1

**Sub-tasks**:
- [ ] Update router in `src/inngest/functions.ts`
- [ ] Add project phase-based routing logic
- [ ] Implement change request detection
- [ ] Add fallback logic for edge cases
- [ ] Add comprehensive logging for routing decisions

#### Task 2.3: State Initialization Enhancement
**Estimated Time**: 2-3 hours
**Priority**: Medium
**Dependencies**: Task 2.2

**Sub-tasks**:
- [ ] Load existing business info into initial state
- [ ] Load existing files from previous fragments
- [ ] Set appropriate project phase in state
- [ ] Handle sandbox restoration for continuing projects

#### Task 2.4: Testing Router Intelligence
**Estimated Time**: 4-5 hours
**Priority**: High
**Dependencies**: Tasks 2.1, 2.2, 2.3

**Sub-tasks**:
- [ ] Test new project flow (should work as before)
- [ ] Test continuing project with business info
- [ ] Test change requests routing directly to code agent
- [ ] Test edge cases (partial business info, corrupted data)
- [ ] Performance testing with state detection queries
- [ ] Integration testing with Phase 1 history loading

### Phase 2 Success Criteria
- [ ] New projects start with business info gathering (existing behavior)
- [ ] Projects with complete business info skip to code generation
- [ ] Change requests route directly to code agent
- [ ] Router decisions are logged and traceable
- [ ] No performance degradation in routing logic
- [ ] All existing functionality preserved

### Phase 2 Risks and Mitigation
- **Risk**: Complex routing logic introduces bugs
  - **Mitigation**: Comprehensive test suite covering all routing scenarios
- **Risk**: Database performance issues with state detection
  - **Mitigation**: Optimize queries, add caching, consider database indexes
- **Risk**: False positives in change request detection
  - **Mitigation**: Conservative approach, allow manual override, user feedback collection

---

## Phase 3: State Context Enhancement 📊

**Objective**: Expand AgentState to track project lifecycle, preserve context, and maintain continuity across agent runs.

### Phase 3 Goals
- [ ] **Enhanced State Interface**: Expand AgentState with lifecycle tracking
- [ ] **Context Preservation**: Maintain sandbox state and file continuity
- [ ] **Change Request Context**: Track what changes are being requested
- [ ] **Performance Optimization**: Efficient state loading and management

### Phase 3 Detailed Tasks

#### Task 3.1: Enhanced AgentState Interface
**Estimated Time**: 1-2 hours
**Priority**: High
**Dependencies**: Phase 2 complete

**Sub-tasks**:
- [ ] Update `AgentState` interface in `src/types.ts`
- [ ] Add project lifecycle tracking fields
- [ ] Add change request context fields
- [ ] Add file versioning and tracking fields
- [ ] Add user session context fields
- [ ] Update TypeScript types throughout codebase

#### Task 3.2: Context Loading Functions
**Estimated Time**: 3-4 hours
**Priority**: High
**Dependencies**: Task 3.1

**Sub-tasks**:
- [ ] Create `loadProjectContext()` function
- [ ] Create `loadExistingFiles()` function
- [ ] Create `restoreSandboxState()` function
- [ ] Add error handling for missing/corrupted context
- [ ] Optimize loading performance with selective data fetching

#### Task 3.3: State Lifecycle Management
**Estimated Time**: 2-3 hours
**Priority**: Medium
**Dependencies**: Task 3.2

**Sub-tasks**:
- [ ] Implement state transition tracking
- [ ] Add state validation functions
- [ ] Create state cleanup for completed projects
- [ ] Add state compression for large file collections
- [ ] Implement state versioning for rollback capability

#### Task 3.4: Agent Context Integration
**Estimated Time**: 3-4 hours
**Priority**: High
**Dependencies**: Tasks 3.1, 3.2, 3.3

**Sub-tasks**:
- [ ] Update agents to use enhanced state
- [ ] Modify business info gatherer to check existing context
- [ ] Update code agent to handle change requests with context
- [ ] Add context-aware prompts and instructions
- [ ] Test agent behavior with enhanced context

### Phase 3 Success Criteria
- [ ] Enhanced state interface supports all project lifecycle stages
- [ ] Context loads efficiently without performance issues
- [ ] Agents operate correctly with enhanced state information
- [ ] File continuity maintained across agent runs
- [ ] Change requests processed with full context awareness
- [ ] State management is reliable and error-resistant

### Phase 3 Risks and Mitigation
- **Risk**: Large state objects cause memory/performance issues
  - **Mitigation**: Implement state compression, lazy loading, and cleanup
- **Risk**: Breaking changes to existing agent behavior
  - **Mitigation**: Gradual migration, backward compatibility, thorough testing
- **Risk**: Complex state management introduces bugs
  - **Mitigation**: State validation, comprehensive testing, monitoring

---

## Phase 4: Memory Layer (Optional Enhancement) 🧠💾

**Objective**: Implement AgentKit Memory capabilities to learn user preferences, remember successful patterns, and provide personalized experiences.

### Phase 4 Goals
- [ ] **User Preference Learning**: Remember design preferences and successful approaches
- [ ] **Pattern Recognition**: Learn from successful website generations
- [ ] **Personalization**: Provide increasingly tailored experiences
- [ ] **Cross-Project Knowledge**: Apply learnings across different user projects

### Phase 4 Detailed Tasks

#### Task 4.1: Memory Infrastructure Setup
**Estimated Time**: 4-5 hours
**Priority**: Medium
**Dependencies**: Phase 3 complete

**Sub-tasks**:
- [ ] Set up Mem0 integration or alternative memory storage
- [ ] Create memory tool implementations
- [ ] Add memory configuration to environment
- [ ] Create memory categorization system (business, design, technical)
- [ ] Implement memory privacy and security measures

#### Task 4.2: Memory-Enhanced Agents
**Estimated Time**: 5-6 hours
**Priority**: Medium
**Dependencies**: Task 4.1

**Sub-tasks**:
- [ ] Add memory tools to business info gatherer
- [ ] Add memory capabilities to code agent
- [ ] Create memory-aware prompt modifications
- [ ] Implement memory retrieval in agent lifecycle hooks
- [ ] Add memory creation for successful outcomes

#### Task 4.3: Learning and Personalization Logic
**Estimated Time**: 4-5 hours
**Priority**: Low
**Dependencies**: Task 4.2

**Sub-tasks**:
- [ ] Implement user preference extraction from conversations
- [ ] Create successful pattern recognition
- [ ] Add cross-project learning capabilities
- [ ] Implement memory-driven personalization
- [ ] Create memory cleanup and maintenance processes

#### Task 4.4: Memory Testing and Optimization
**Estimated Time**: 3-4 hours
**Priority**: Low
**Dependencies**: Tasks 4.1, 4.2, 4.3

**Sub-tasks**:
- [ ] Test memory storage and retrieval
- [ ] Validate personalization improvements
- [ ] Performance testing with memory operations
- [ ] Privacy compliance testing
- [ ] Memory system reliability testing

### Phase 4 Success Criteria
- [ ] Memory system stores and retrieves user preferences accurately
- [ ] Agents provide increasingly personalized experiences
- [ ] Memory system operates without performance impact
- [ ] User privacy and data security maintained
- [ ] Memory insights improve website generation quality

### Phase 4 Risks and Mitigation
- **Risk**: Memory system adds complexity without clear value
  - **Mitigation**: A/B testing, user feedback collection, metrics tracking
- **Risk**: Privacy concerns with storing user data
  - **Mitigation**: Privacy compliance, data encryption, user consent
- **Risk**: Memory operations impact performance
  - **Mitigation**: Async operations, caching, efficient storage design

---

## Implementation Timeline

### Sprint 1 (Week 1-2): History Integration
- **Duration**: 2 weeks
- **Team Size**: 1-2 developers
- **Focus**: Phase 1 complete implementation
- **Deliverables**: Working History Adapter, conversation persistence

### Sprint 2 (Week 3-4): Router Intelligence  
- **Duration**: 2 weeks
- **Team Size**: 1-2 developers
- **Focus**: Phase 2 complete implementation
- **Deliverables**: Smart routing, context-aware agent selection

### Sprint 3 (Week 5-6): State Enhancement
- **Duration**: 2 weeks
- **Team Size**: 1-2 developers
- **Focus**: Phase 3 complete implementation
- **Deliverables**: Enhanced state management, context preservation

### Sprint 4 (Week 7-8): Memory Layer (Optional)
- **Duration**: 2 weeks
- **Team Size**: 1 developer
- **Focus**: Phase 4 implementation
- **Deliverables**: Memory system, personalization features

### Sprint 5 (Week 9): Integration and Polish
- **Duration**: 1 week
- **Team Size**: 2 developers
- **Focus**: End-to-end testing, bug fixes, performance optimization
- **Deliverables**: Production-ready system

## Risk Assessment and Mitigation

### High-Risk Items
1. **Database Schema Changes**: Modifying existing models
   - **Mitigation**: Use existing schema, additive changes only
2. **Breaking Existing Functionality**: Disrupting current workflows
   - **Mitigation**: Feature flags, gradual rollout, comprehensive testing
3. **Performance Degradation**: History loading impacting response times
   - **Mitigation**: Optimization, caching, monitoring

### Medium-Risk Items
1. **Complex State Management**: Managing enhanced state across agents
   - **Mitigation**: Careful design, validation, testing
2. **Memory System Complexity**: Adding another layer of data management
   - **Mitigation**: Optional implementation, simple design, monitoring

### Low-Risk Items
1. **User Preference Learning**: Nice-to-have feature
   - **Mitigation**: Phase 4 is optional, can be deferred

## Success Metrics

### Phase 1 Success Metrics
- [ ] Conversation history loads in <500ms
- [ ] 100% message preservation accuracy
- [ ] Zero breaking changes to existing functionality

### Phase 2 Success Metrics
- [ ] 95% correct routing decisions for continuing projects
- [ ] 90% reduction in unnecessary business info questions
- [ ] Router decision time <100ms

### Phase 3 Success Metrics
- [ ] Context loading in <1s for typical projects
- [ ] 100% file continuity for code iterations
- [ ] Memory usage remains under 50MB per project

### Phase 4 Success Metrics (Optional)
- [ ] 20% improvement in user satisfaction scores
- [ ] 15% increase in successful first-try generations
- [ ] Memory operations complete in <200ms

## Rollback Plan

Each phase includes rollback capabilities:

1. **Feature Flags**: Enable/disable new functionality
2. **Database Compatibility**: No breaking schema changes
3. **Code Versioning**: Git branches for each phase
4. **Monitoring**: Real-time system health monitoring
5. **Gradual Rollout**: Percentage-based user rollout

## Conclusion

This incremental approach ensures each phase delivers value while minimizing risk. The plan leverages AgentKit's built-in concepts for persistence and context management, building on Intuivox's existing solid architecture.

**Next Steps**:
1. Review and approve this plan
2. Begin Phase 1 implementation
3. Set up monitoring and testing infrastructure
4. Establish regular progress reviews