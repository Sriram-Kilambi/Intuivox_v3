/**
 * Validation script for History Adapter implementation
 * 
 * This script can be run to validate that the history adapter
 * is working correctly with the database.
 * 
 * Usage: npx tsx src/inngest/validate-history.ts
 */

import { prisma } from '@/lib/db';
import { 
  convertMessageToAgentResult, 
  convertAgentResultToMessage,
  convertMessagesToAgentResults 
} from './history-adapter';

async function validateHistoryAdapter() {
  console.log('🧪 Starting History Adapter Validation...\n');
  
  try {
    // Test 1: Database Connection
    console.log('1️⃣ Testing database connection...');
    const projectCount = await prisma.project.count();
    console.log(`✅ Database connected. Found ${projectCount} projects.\n`);
    
    // Test 2: Message Loading
    console.log('2️⃣ Testing message loading...');
    const messages = await prisma.message.findMany({
      include: { fragment: true },
      take: 3
    });
    console.log(`✅ Loaded ${messages.length} messages from database.\n`);
    
    if (messages.length > 0) {
      // Test 3: Message to AgentResult Conversion
      console.log('3️⃣ Testing message to AgentResult conversion...');
      try {
        const agentResults = convertMessagesToAgentResults(messages);
        console.log(`✅ Successfully converted ${agentResults.length} messages to AgentResults.`);
        
        // Show first conversion for inspection
        if (agentResults.length > 0) {
          console.log('📄 First converted message:');
          console.log(JSON.stringify({
            originalId: messages[0].id,
            convertedAgentName: agentResults[0].agentName,
            convertedContent: agentResults[0].output[0]?.content?.slice(0, 100) + '...',
            hasToolCalls: agentResults[0].toolCalls.length > 0
          }, null, 2));
        }
        console.log('');
        
        // Test 4: AgentResult to Message Conversion
        console.log('4️⃣ Testing AgentResult to Message conversion...');
        if (agentResults.length > 0) {
          const testProject = messages[0].projectId;
          const messageData = convertAgentResultToMessage(agentResults[0], testProject);
          console.log('✅ Successfully converted AgentResult back to Message format.');
          console.log('📄 Converted message data:');
          console.log(JSON.stringify({
            content: messageData.content.slice(0, 100) + '...',
            role: messageData.role,
            type: messageData.type,
            hasFragment: !!messageData.fragment
          }, null, 2));
          console.log('');
        }
      } catch (conversionError) {
        console.error('❌ Conversion test failed:', conversionError);
        return false;
      }
    } else {
      console.log('⚠️  No messages found in database to test conversions.\n');
    }
    
    // Test 5: History Adapter Methods
    console.log('5️⃣ Testing History Adapter methods...');
    
    // Find a project to test with
    const testProject = await prisma.project.findFirst();
    if (testProject) {
      console.log(`📋 Testing with project: ${testProject.name} (${testProject.id})`);
      
      // Test createThread
      const { intuivoxHistoryAdapter } = await import('./history-adapter');
      
      try {
        const threadResult = await intuivoxHistoryAdapter.createThread({
          state: { data: { projectId: testProject.id } },
          input: 'Test input',
          network: null as any
        });
        console.log(`✅ createThread returned: ${threadResult.threadId}`);
        
        // Test get method
        const historyResults = await intuivoxHistoryAdapter.get({
          threadId: testProject.id,
          state: { data: { projectId: testProject.id } },
          network: null as any
        });
        console.log(`✅ get method returned ${historyResults.length} history items`);
        
        console.log('');
      } catch (adapterError) {
        console.error('❌ History adapter method test failed:', adapterError);
        return false;
      }
    } else {
      console.log('⚠️  No projects found to test history adapter methods.\n');
    }
    
    // Test 6: Environment Configuration
    console.log('6️⃣ Testing environment configuration...');
    const historyEnabled = process.env.ENABLE_AGENTKIT_HISTORY === 'true';
    console.log(`📊 ENABLE_AGENTKIT_HISTORY: ${historyEnabled ? 'ENABLED ✅' : 'DISABLED (default)'}`);
    console.log('');
    
    // Summary
    console.log('🎉 All History Adapter validations completed successfully!\n');
    
    console.log('📋 Next Steps:');
    console.log('1. To test the full integration, set ENABLE_AGENTKIT_HISTORY=true in .env');
    console.log('2. Start the application and create a new conversation');
    console.log('3. Check console logs for history adapter messages');
    console.log('4. Verify conversation persistence by making follow-up requests');
    console.log('');
    
    return true;
    
  } catch (error) {
    console.error('❌ Validation failed:', error);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Self-executing validation function
async function main() {
  const success = await validateHistoryAdapter();
  process.exit(success ? 0 : 1);
}

if (require.main === module) {
  main();
}

export { validateHistoryAdapter };