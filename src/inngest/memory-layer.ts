/**
 * Phase 4: Memory Layer (Optional) 🧠
 * Simple persistent memory for user preferences and project patterns
 */

import { prisma } from '@/lib/db';

/**
 * Memory types for different categories of information
 */
export type MemoryType = 
  | 'USER_PREFERENCE'     // User's style/design preferences
  | 'PROJECT_PATTERN'     // Common patterns in user's projects
  | 'BUSINESS_CONTEXT'    // Long-term business context
  | 'TECHNICAL_PREFERENCE'; // Technical stack preferences

/**
 * Memory entry structure
 */
interface MemoryEntry {
  id?: string;
  userId?: string;
  projectId?: string;
  type: MemoryType;
  key: string;
  value: any;
  confidence: number; // 0-1 confidence score
  lastUsed: Date;
  useCount: number;
}

/**
 * Simple in-memory cache for frequently accessed memories
 */
const memoryCache = new Map<string, MemoryEntry>();

/**
 * Store a memory entry
 */
export const storeMemory = async (entry: Omit<MemoryEntry, 'id'>): Promise<void> => {
  console.log(`🧠 MEMORY: Storing ${entry.type} memory: ${entry.key}`);
  
  try {
    // For this simple implementation, we'll use a comment table or log
    // In a full implementation, you'd create a dedicated memory table
    console.log(`📝 MEMORY: Would store:`, {
      type: entry.type,
      key: entry.key,
      confidence: entry.confidence,
      projectId: entry.projectId
    });
    
    // Cache the entry
    const cacheKey = `${entry.projectId || 'global'}_${entry.type}_${entry.key}`;
    memoryCache.set(cacheKey, { ...entry, id: cacheKey });
    
  } catch (error) {
    console.error(`❌ MEMORY: Error storing memory:`, error);
  }
};

/**
 * Retrieve memory entries
 */
export const getMemories = async (
  projectId: string, 
  type?: MemoryType, 
  key?: string
): Promise<MemoryEntry[]> => {
  console.log(`🧠 MEMORY: Retrieving memories for project: ${projectId}`);
  
  try {
    const memories: MemoryEntry[] = [];
    
    // Search cache
    for (const [cacheKey, entry] of memoryCache.entries()) {
      const matchesProject = cacheKey.startsWith(projectId) || cacheKey.startsWith('global');
      const matchesType = !type || entry.type === type;
      const matchesKey = !key || entry.key === key;
      
      if (matchesProject && matchesType && matchesKey) {
        memories.push(entry);
      }
    }
    
    console.log(`✅ MEMORY: Found ${memories.length} memories`);
    return memories.sort((a, b) => b.confidence - a.confidence);
    
  } catch (error) {
    console.error(`❌ MEMORY: Error retrieving memories:`, error);
    return [];
  }
};

/**
 * Learn from user interactions and store patterns
 */
export const learnFromInteraction = async (
  projectId: string, 
  userInput: string, 
  agentResponse: string
): Promise<void> => {
  console.log(`🧠 MEMORY: Learning from interaction in project: ${projectId}`);
  
  try {
    // Extract patterns from user input
    if (userInput.toLowerCase().includes('color') && userInput.toLowerCase().includes('blue')) {
      await storeMemory({
        projectId,
        type: 'USER_PREFERENCE',
        key: 'preferred_color',
        value: 'blue',
        confidence: 0.7,
        lastUsed: new Date(),
        useCount: 1
      });
    }
    
    if (userInput.toLowerCase().includes('modern') || userInput.toLowerCase().includes('clean')) {
      await storeMemory({
        projectId,
        type: 'USER_PREFERENCE', 
        key: 'design_style',
        value: 'modern',
        confidence: 0.6,
        lastUsed: new Date(),
        useCount: 1
      });
    }
    
    // Learn business context patterns
    if (agentResponse.includes('business') && agentResponse.includes('restaurant')) {
      await storeMemory({
        projectId,
        type: 'BUSINESS_CONTEXT',
        key: 'industry_type', 
        value: 'restaurant',
        confidence: 0.8,
        lastUsed: new Date(),
        useCount: 1
      });
    }
    
  } catch (error) {
    console.error(`❌ MEMORY: Error learning from interaction:`, error);
  }
};

/**
 * Get contextual suggestions based on memory
 */
export const getContextualSuggestions = async (
  projectId: string, 
  currentInput: string
): Promise<string[]> => {
  console.log(`🧠 MEMORY: Getting contextual suggestions for: "${currentInput.slice(0, 50)}..."`);
  
  try {
    const suggestions: string[] = [];
    const memories = await getMemories(projectId);
    
    // Suggest based on user preferences
    const colorMemories = memories.filter(m => m.key === 'preferred_color');
    if (colorMemories.length > 0 && currentInput.toLowerCase().includes('color')) {
      const preferredColor = colorMemories[0].value;
      suggestions.push(`Consider using ${preferredColor} based on your previous preferences`);
    }
    
    const styleMemories = memories.filter(m => m.key === 'design_style'); 
    if (styleMemories.length > 0) {
      const preferredStyle = styleMemories[0].value;
      suggestions.push(`Apply ${preferredStyle} design principles`);
    }
    
    console.log(`✅ MEMORY: Generated ${suggestions.length} contextual suggestions`);
    return suggestions;
    
  } catch (error) {
    console.error(`❌ MEMORY: Error generating suggestions:`, error);
    return [];
  }
};

/**
 * Simple memory integration - called from main agent flow
 */
export const integrateMemoryLayer = async (
  projectId: string,
  userInput: string,
  projectContext: any
): Promise<{ suggestions: string[]; enhancedContext: any }> => {
  console.log(`🧠 MEMORY: Integrating memory layer for project: ${projectId}`);
  
  try {
    // Get contextual suggestions
    const suggestions = await getContextualSuggestions(projectId, userInput);
    
    // Enhance context with relevant memories
    const memories = await getMemories(projectId);
    const enhancedContext = {
      ...projectContext,
      userPreferences: memories.filter(m => m.type === 'USER_PREFERENCE'),
      businessPatterns: memories.filter(m => m.type === 'BUSINESS_CONTEXT'),
      technicalPreferences: memories.filter(m => m.type === 'TECHNICAL_PREFERENCE')
    };
    
    console.log(`✅ MEMORY: Memory integration complete - ${suggestions.length} suggestions, ${memories.length} memories`);
    
    return { suggestions, enhancedContext };
    
  } catch (error) {
    console.error(`❌ MEMORY: Error in memory integration:`, error);
    return { suggestions: [], enhancedContext: projectContext };
  }
};