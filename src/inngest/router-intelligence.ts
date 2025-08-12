/**
 * Phase 2: Router Intelligence 🧠
 * Enhanced router logic to detect project state and route appropriately
 * based on existing business info and generated code.
 */

import { prisma } from '@/lib/db';
import { Message } from '@inngest/agent-kit';

/**
 * Project phases for routing decisions
 */
export type ProjectPhase = 
  | 'NEW'           // New project, needs business info
  | 'BUSINESS_INFO' // Has business info, ready for code generation  
  | 'CODE_READY'    // Has generated code, ready for modifications
  | 'ITERATING';    // Actively making changes to existing code

/**
 * Business info completeness check result
 */
interface BusinessInfoStatus {
  isComplete: boolean;
  businessName?: string;
  businessDescription?: string;
  businessIndustry?: string;
  businessSubIndustry?: string;
  businessAddress?: string;
  businessContactInfo?: string;
  source: 'DATABASE' | 'HISTORY' | 'STATE';
}

/**
 * Project state summary for routing decisions
 */
interface ProjectState {
  phase: ProjectPhase;
  businessInfo: BusinessInfoStatus;
  hasGeneratedCode: boolean;
  lastCodeGeneration?: Date;
  messageCount: number;
  isChangeRequest: boolean;
}

/**
 * Check if project has existing business information
 */
export const checkExistingBusinessInfo = async (projectId: string): Promise<BusinessInfoStatus> => {
  console.log(`🔍 ROUTER: Checking existing business info for project: ${projectId}`);
  
  try {
    // Look for business info in conversation messages
    const messages = await prisma.message.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' }
    });

    console.log(`📝 ROUTER: Found ${messages.length} messages to analyze`);

    // Method 1: Look for structured business_info tags
    for (const message of messages) {
      if (message.role === 'ASSISTANT' && message.content.includes('<business_info>')) {
        console.log(`🎯 ROUTER: Found structured business_info in message ${message.id}`);
        
        const businessInfoMatch = message.content.match(
          /<business_info>([\s\S]*?)<\/business_info>/
        );
        
        if (businessInfoMatch) {
          try {
            const parsedBusinessInfo = JSON.parse(businessInfoMatch[1]);
            
            const status: BusinessInfoStatus = {
              isComplete: !!(parsedBusinessInfo.businessName && 
                            parsedBusinessInfo.businessDescription &&
                            parsedBusinessInfo.businessIndustry),
              businessName: parsedBusinessInfo.businessName,
              businessDescription: parsedBusinessInfo.businessDescription,
              businessIndustry: parsedBusinessInfo.businessIndustry,
              businessSubIndustry: parsedBusinessInfo.businessSubIndustry,
              businessAddress: parsedBusinessInfo.businessAddress,
              businessContactInfo: parsedBusinessInfo.businessContactInfo,
              source: 'DATABASE'
            };
            
            console.log(`✅ ROUTER: Found structured business info:`, status);
            return status;
          } catch (error) {
            console.warn(`⚠️ ROUTER: Could not parse business info JSON:`, error);
          }
        }
      }
    }

    // Method 2: Enhanced pattern matching for business info extraction
    console.log(`🔍 ROUTER: No structured format found, using enhanced pattern matching...`);
    const businessInfo: Partial<BusinessInfoStatus> = { source: 'DATABASE' };
    
    // First pass: Look for direct business mentions in user messages
    for (const message of messages) {
      if (message.role === 'USER') {
        const content = message.content.toLowerCase();
        const originalContent = message.content;
        
        // Extract business name and type from initial request
        if (content.includes('website for') || content.includes('site for')) {
          // "I want a website for my clothes store" -> clothes store
          const businessMatch = originalContent.match(/(?:website|site) for (?:my |a |an |the )?([^.]+)/i);
          if (businessMatch) {
            businessInfo.businessName = businessMatch[1].trim();
            console.log(`📋 ROUTER: Found business from initial request: ${businessInfo.businessName}`);
            
            // Determine industry from business type
            if (content.includes('clothes') || content.includes('clothing') || content.includes('fashion')) {
              businessInfo.businessIndustry = 'retail';
              businessInfo.businessSubIndustry = 'clothing';
              businessInfo.businessDescription = businessMatch[1].trim();
              console.log(`📋 ROUTER: Inferred industry: retail/clothing`);
            } else if (content.includes('restaurant') || content.includes('food') || content.includes('cafe')) {
              businessInfo.businessIndustry = 'food';
              businessInfo.businessSubIndustry = 'restaurant';
              businessInfo.businessDescription = businessMatch[1].trim();
              console.log(`📋 ROUTER: Inferred industry: food/restaurant`);
            } else if (content.includes('shop') || content.includes('store')) {
              businessInfo.businessIndustry = 'retail';
              businessInfo.businessDescription = businessMatch[1].trim();
              console.log(`📋 ROUTER: Inferred industry: retail`);
            }
          }
        }
      }
    }
    
    // Second pass: Look for Q&A patterns with flexible matching
    for (let i = 0; i < messages.length - 1; i++) {
      const question = messages[i];
      const answer = messages[i + 1];
      
      if (question.role === 'ASSISTANT' && answer.role === 'USER') {
        const questionContent = question.content.toLowerCase();
        const answerContent = answer.content.trim();
        
        // More flexible business name extraction
        if ((questionContent.includes('name') || questionContent.includes('called')) && 
            (questionContent.includes('business') || questionContent.includes('company') || questionContent.includes('store'))) {
          if (!businessInfo.businessName) {
            businessInfo.businessName = answerContent;
            console.log(`📋 ROUTER: Extracted business name from Q&A: ${answerContent}`);
          }
        }
        
        // Flexible business description
        if ((questionContent.includes('describe') || questionContent.includes('tell me about') || 
             questionContent.includes('what do') || questionContent.includes('what does')) &&
            (questionContent.includes('business') || questionContent.includes('company'))) {
          if (!businessInfo.businessDescription) {
            businessInfo.businessDescription = answerContent;
            console.log(`📋 ROUTER: Extracted business description from Q&A: ${answerContent}`);
          }
        }
        
        // Industry extraction
        if (questionContent.includes('industry') || questionContent.includes('type of business')) {
          // Handle various answer formats
          const lowerAnswer = answerContent.toLowerCase();
          if (lowerAnswer.includes('retail') || lowerAnswer.includes('store') || lowerAnswer.includes('shop')) {
            businessInfo.businessIndustry = 'retail';
          } else if (lowerAnswer.includes('food') || lowerAnswer.includes('restaurant')) {
            businessInfo.businessIndustry = 'food';
          } else {
            businessInfo.businessIndustry = answerContent;
          }
          console.log(`📋 ROUTER: Extracted industry: ${businessInfo.businessIndustry}`);
        }
        
        // Address extraction
        if (questionContent.includes('address') || questionContent.includes('located') || questionContent.includes('where')) {
          if (!businessInfo.businessAddress) {
            businessInfo.businessAddress = answerContent;
            console.log(`📋 ROUTER: Extracted address: ${answerContent}`);
          }
        }
        
        // Contact info
        if (questionContent.includes('contact') || questionContent.includes('phone') || questionContent.includes('email')) {
          if (!businessInfo.businessContactInfo) {
            businessInfo.businessContactInfo = answerContent;
            console.log(`📋 ROUTER: Extracted contact: ${answerContent}`);
          }
        }
      }
    }

    // Third pass: Look for any remaining patterns in user responses
    for (const message of messages) {
      if (message.role === 'USER') {
        const content = message.content;
        
        // Look for location patterns
        if (!businessInfo.businessAddress && (content.includes(',') || content.match(/\b\d{5}\b/))) {
          // Might be an address (contains comma or zip code)
          if (content.split(' ').length <= 10) { // Reasonable address length
            businessInfo.businessAddress = content;
            console.log(`📋 ROUTER: Potential address found: ${content}`);
          }
        }
        
        // Look for contact patterns
        if (!businessInfo.businessContactInfo) {
          if (content.match(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/) || content.includes('@')) {
            businessInfo.businessContactInfo = content;
            console.log(`📋 ROUTER: Potential contact found: ${content}`);
          }
        }
      }
    }

    // More lenient completion check - only require core business info
    const hasEssentialInfo = !!(businessInfo.businessName || businessInfo.businessDescription);
    const hasIndustryInfo = !!businessInfo.businessIndustry;
    const hasContactOrLocation = !!(businessInfo.businessAddress || businessInfo.businessContactInfo);
    
    // Consider complete if we have essential info + either industry or contact details
    const isComplete = hasEssentialInfo && (hasIndustryInfo || hasContactOrLocation);
    
    const status: BusinessInfoStatus = {
      isComplete,
      businessName: businessInfo.businessName,
      businessDescription: businessInfo.businessDescription,
      businessIndustry: businessInfo.businessIndustry,
      businessSubIndustry: businessInfo.businessSubIndustry,
      businessAddress: businessInfo.businessAddress,
      businessContactInfo: businessInfo.businessContactInfo,
      source: 'DATABASE'
    };

    // Enhanced completion logging
    console.log(`📊 ROUTER: Business info analysis results:`);
    console.log(`  - Essential info (name/desc): ${hasEssentialInfo}`);
    console.log(`  - Industry info: ${hasIndustryInfo}`);
    console.log(`  - Contact/Location info: ${hasContactOrLocation}`);
    console.log(`  - Overall complete: ${isComplete}`);
    
    if (status.isComplete) {
      console.log(`✅ ROUTER: Business info marked as COMPLETE:`, {
        name: status.businessName,
        description: status.businessDescription,
        industry: status.businessIndustry,
        subIndustry: status.businessSubIndustry,
        address: status.businessAddress,
        contact: status.businessContactInfo
      });
    } else {
      console.log(`📭 ROUTER: Business info marked as INCOMPLETE - missing required fields`);
    }

    return status;
    
  } catch (error) {
    console.error(`❌ ROUTER: Error checking business info:`, error);
    return {
      isComplete: false,
      source: 'DATABASE'
    };
  }
};

/**
 * Check if project has existing generated code
 */
export const checkExistingCode = async (projectId: string): Promise<boolean> => {
  console.log(`🔍 ROUTER: Checking existing code for project: ${projectId}`);
  
  try {
    // Look for messages with fragments (generated code)
    const fragmentCount = await prisma.fragment.count({
      where: {
        message: {
          projectId
        }
      }
    });

    console.log(`📝 ROUTER: Found ${fragmentCount} code fragments`);
    return fragmentCount > 0;
    
  } catch (error) {
    console.error(`❌ ROUTER: Error checking existing code:`, error);
    return false;
  }
};

/**
 * Detect current project phase for routing decisions
 */
export const detectProjectPhase = async (projectId: string): Promise<ProjectPhase> => {
  console.log(`🔍 ROUTER: Detecting project phase for: ${projectId}`);
  
  const [businessInfo, hasCode] = await Promise.all([
    checkExistingBusinessInfo(projectId),
    checkExistingCode(projectId)
  ]);

  let phase: ProjectPhase;
  
  if (!businessInfo.isComplete) {
    phase = 'NEW';
  } else if (!hasCode) {
    phase = 'BUSINESS_INFO';
  } else {
    phase = 'CODE_READY';
  }

  console.log(`🧭 ROUTER: Detected project phase: ${phase}`, {
    businessInfoComplete: businessInfo.isComplete,
    hasGeneratedCode: hasCode
  });

  return phase;
};

/**
 * Analyze user input to determine if it's a change request
 */
export const isChangeRequest = (userInput: string): boolean => {
  console.log(`🔍 ROUTER: Analyzing input for change request: "${userInput.slice(0, 50)}..."`);
  
  const input = userInput.toLowerCase().trim();
  
  // Common change request patterns
  const changePatterns = [
    // Direct modification requests
    /change|modify|update|alter|edit|fix/,
    // Color/style changes
    /color|background|font|size|style|theme/,
    // Layout changes
    /move|position|layout|align|center|left|right/,
    // Content changes
    /text|content|wording|copy|title|heading/,
    // Feature modifications
    /add|remove|delete|include|exclude/,
    // Make it/make the
    /make\s+(the|it)\s+/,
    // I want to/I'd like to (with context suggesting changes)
    /(?:want|like)\s+to\s+(?:change|modify|update|make|add|remove)/
  ];

  const isChange = changePatterns.some(pattern => pattern.test(input));
  
  console.log(`${isChange ? '✅' : '❌'} ROUTER: Input ${isChange ? 'IS' : 'IS NOT'} a change request`);
  
  return isChange;
};

/**
 * Get comprehensive project state for routing decisions
 */
export const getProjectState = async (projectId: string, userInput: string): Promise<ProjectState> => {
  console.log(`🔍 ROUTER: Getting complete project state for: ${projectId}`);
  
  const [phase, businessInfo, hasCode, messageCount] = await Promise.all([
    detectProjectPhase(projectId),
    checkExistingBusinessInfo(projectId),
    checkExistingCode(projectId),
    prisma.message.count({ where: { projectId } })
  ]);

  // Get last code generation timestamp
  const lastFragment = await prisma.fragment.findFirst({
    where: {
      message: {
        projectId
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  const projectState: ProjectState = {
    phase,
    businessInfo,
    hasGeneratedCode: hasCode,
    lastCodeGeneration: lastFragment?.createdAt,
    messageCount,
    isChangeRequest: isChangeRequest(userInput)
  };

  console.log(`📊 ROUTER: Complete project state:`, {
    phase: projectState.phase,
    businessInfoComplete: projectState.businessInfo.isComplete,
    hasGeneratedCode: projectState.hasGeneratedCode,
    messageCount: projectState.messageCount,
    isChangeRequest: projectState.isChangeRequest,
    lastCodeGeneration: projectState.lastCodeGeneration?.toISOString()
  });

  return projectState;
};