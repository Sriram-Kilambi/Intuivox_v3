/**
 * Debug script to inspect actual business info conversation patterns
 */

import { prisma } from '@/lib/db';

async function debugBusinessInfoConversation(projectId: string) {
  console.log(`🔍 DEBUG: Analyzing business info conversation for project: ${projectId}`);
  
  try {
    const messages = await prisma.message.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: { fragment: true }
    });

    console.log(`📝 DEBUG: Found ${messages.length} messages`);

    // Analyze conversation patterns
    let foundInfo = {
      businessName: null as string | null,
      businessDescription: null as string | null,
      businessIndustry: null as string | null,
      businessSubIndustry: null as string | null,
      businessAddress: null as string | null,
      businessContactInfo: null as string | null
    };

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      console.log(`\n--- Message ${i + 1} ---`);
      console.log(`Role: ${message.role}`);
      console.log(`Type: ${message.type}`);
      console.log(`Content: ${message.content}`);
      
      if (message.role === 'USER') {
        const content = message.content.toLowerCase();
        const originalContent = message.content;
        
        // Look for business name patterns
        if (content.includes('store') || content.includes('shop') || content.includes('company')) {
          if (content.includes('clothes') || content.includes('clothing')) {
            foundInfo.businessName = originalContent;
            foundInfo.businessIndustry = 'retail';
            foundInfo.businessSubIndustry = 'clothing';
            console.log(`🎯 POTENTIAL BUSINESS INFO FOUND:`);
            console.log(`  - Business: ${foundInfo.businessName}`);
            console.log(`  - Industry: ${foundInfo.businessIndustry}`);
            console.log(`  - Sub-industry: ${foundInfo.businessSubIndustry}`);
          }
        }
      }
    }

    // Check current state using our router intelligence
    const { checkExistingBusinessInfo } = await import('./router-intelligence');
    const businessStatus = await checkExistingBusinessInfo(projectId);
    
    console.log(`\n📊 CURRENT ROUTER ASSESSMENT:`);
    console.log(`Business info complete: ${businessStatus.isComplete}`);
    console.log(`Business name: ${businessStatus.businessName || 'NOT FOUND'}`);
    console.log(`Business description: ${businessStatus.businessDescription || 'NOT FOUND'}`);
    console.log(`Business industry: ${businessStatus.businessIndustry || 'NOT FOUND'}`);

    return { messages, foundInfo, businessStatus };

  } catch (error) {
    console.error('❌ DEBUG: Error analyzing conversation:', error);
    return null;
  }
}

// Export for use in main code
export { debugBusinessInfoConversation };