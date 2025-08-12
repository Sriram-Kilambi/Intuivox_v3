/**
 * Tests for Intuivox History Adapter (Phase 1)
 * 
 * These tests verify the conversion functions and basic functionality
 * of the history adapter without requiring a full database setup.
 */

import { 
  convertMessageToAgentResult, 
  convertAgentResultToMessage,
  convertMessagesToAgentResults,
  convertAgentResultsToMessages
} from '../history-adapter';
import { AgentResult } from '@inngest/agent-kit';
import { MessageRole, MessageType } from '@/generated/prisma';

// Mock Prisma client to avoid database dependency in tests
jest.mock('@/lib/db', () => ({
  prisma: {
    message: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    project: {
      findUnique: jest.fn(),
    }
  }
}));

describe('History Adapter Conversion Functions', () => {
  
  describe('convertMessageToAgentResult', () => {
    it('should convert a basic user message correctly', () => {
      const message = {
        id: 'msg-123',
        content: 'Hello, I want to create a restaurant website',
        role: 'USER' as MessageRole,
        type: 'RESULT' as MessageType,
        createdAt: new Date('2024-01-01T10:00:00Z'),
        fragment: null
      };

      const result = convertMessageToAgentResult(message);

      expect(result).toEqual({
        output: [{
          type: 'text',
          role: 'user',
          content: 'Hello, I want to create a restaurant website'
        }],
        agentName: 'code-agent',
        toolCalls: [],
        timestamp: '2024-01-01T10:00:00.000Z',
        metadata: {
          messageId: 'msg-123',
          messageType: 'RESULT',
          hasFragment: false,
          originalRole: 'USER'
        }
      });
    });

    it('should convert an assistant message with fragment correctly', () => {
      const message = {
        id: 'msg-456',
        content: 'I have generated a restaurant website for you.',
        role: 'ASSISTANT' as MessageRole,
        type: 'RESULT' as MessageType,
        createdAt: new Date('2024-01-01T10:05:00Z'),
        fragment: {
          id: 'frag-123',
          sandboxUrl: 'https://sandbox.example.com',
          title: 'Restaurant Website',
          files: {
            'app/page.tsx': 'export default function Page() { return <div>Restaurant</div>; }',
            'app/layout.tsx': 'export default function Layout() { return <html><body>{children}</body></html>; }'
          },
          createdAt: new Date('2024-01-01T10:05:00Z')
        }
      };

      const result = convertMessageToAgentResult(message);

      expect(result.output[0]).toEqual({
        type: 'text',
        role: 'assistant',
        content: 'I have generated a restaurant website for you.'
      });

      expect(result.agentName).toBe('code-agent');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toEqual({
        toolName: 'createOrUpdateFiles',
        parameters: {
          files: [
            { path: 'app/page.tsx', content: 'export default function Page() { return <div>Restaurant</div>; }' },
            { path: 'app/layout.tsx', content: 'export default function Layout() { return <html><body>{children}</body></html>; }' }
          ]
        },
        result: {
          sandboxUrl: 'https://sandbox.example.com',
          title: 'Restaurant Website',
          files: {
            'app/page.tsx': 'export default function Page() { return <div>Restaurant</div>; }',
            'app/layout.tsx': 'export default function Layout() { return <html><body>{children}</body></html>; }'
          },
          fragmentId: 'frag-123',
          createdAt: new Date('2024-01-01T10:05:00Z')
        }
      });
    });

    it('should handle invalid message gracefully', () => {
      const invalidMessage = {
        id: 'msg-invalid',
        content: null, // Invalid content
        role: 'USER' as MessageRole,
        type: 'RESULT' as MessageType,
        createdAt: new Date(),
        fragment: null
      };

      expect(() => convertMessageToAgentResult(invalidMessage))
        .toThrow('Invalid message data for conversion');
    });
  });

  describe('convertAgentResultToMessage', () => {
    it('should convert a basic agent result correctly', () => {
      const agentResult: AgentResult = {
        output: [{
          type: 'text',
          role: 'assistant',
          content: 'What type of cuisine does your restaurant serve?'
        }],
        agentName: 'business-info-gatherer-agent',
        toolCalls: [],
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      const messageData = convertAgentResultToMessage(agentResult, 'project-123');

      expect(messageData).toEqual({
        content: 'What type of cuisine does your restaurant serve?',
        role: 'ASSISTANT',
        type: 'AGENT_QUESTION', // Should be detected as a question
        projectId: 'project-123'
      });
    });

    it('should convert agent result with tool calls to message with fragment', () => {
      const agentResult: AgentResult = {
        output: [{
          type: 'text',
          role: 'assistant', 
          content: 'I have created your website files.'
        }],
        agentName: 'code-agent',
        toolCalls: [{
          toolName: 'createOrUpdateFiles',
          parameters: {
            files: [
              { path: 'app/page.tsx', content: '<div>Hello World</div>' }
            ]
          },
          result: {
            sandboxUrl: 'https://sandbox.example.com',
            title: 'Generated Website',
            files: { 'app/page.tsx': '<div>Hello World</div>' }
          }
        }],
        timestamp: '2024-01-01T10:05:00.000Z'
      };

      const messageData = convertAgentResultToMessage(agentResult, 'project-123');

      expect(messageData.content).toBe('I have created your website files.');
      expect(messageData.role).toBe('ASSISTANT');
      expect(messageData.type).toBe('RESULT');
      expect(messageData.projectId).toBe('project-123');
      expect(messageData.fragment).toEqual({
        create: {
          sandboxUrl: 'https://sandbox.example.com',
          title: 'Generated Website',
          files: { 'app/page.tsx': '<div>Hello World</div>' }
        }
      });
    });

    it('should handle invalid agent result gracefully', () => {
      const invalidResult = {
        output: [], // Empty output array
        agentName: 'test-agent',
        toolCalls: [],
        timestamp: '2024-01-01T10:00:00.000Z'
      } as AgentResult;

      expect(() => convertAgentResultToMessage(invalidResult, 'project-123'))
        .toThrow('Invalid AgentResult for conversion to Message');
    });
  });

  describe('Batch Conversion Functions', () => {
    it('should handle batch message to agent result conversion with errors', () => {
      const messages = [
        {
          id: 'msg-1',
          content: 'Valid message',
          role: 'USER' as MessageRole,
          type: 'RESULT' as MessageType,
          createdAt: new Date(),
          fragment: null
        },
        {
          id: 'msg-2',
          content: null, // Invalid message
          role: 'USER' as MessageRole,
          type: 'RESULT' as MessageType,
          createdAt: new Date(),
          fragment: null
        }
      ];

      const results = convertMessagesToAgentResults(messages);

      expect(results).toHaveLength(2);
      expect(results[0].output[0].content).toBe('Valid message');
      expect(results[1].output[0].content).toContain('[Error loading message:');
      expect(results[1].error).toBeDefined();
    });

    it('should handle batch agent result to message conversion', () => {
      const agentResults: AgentResult[] = [
        {
          output: [{
            type: 'text',
            role: 'user',
            content: 'Hello'
          }],
          agentName: 'user',
          toolCalls: [],
          timestamp: '2024-01-01T10:00:00.000Z'
        },
        {
          output: [{
            type: 'text',
            role: 'assistant',
            content: 'Hi there!'
          }],
          agentName: 'code-agent',
          toolCalls: [],
          timestamp: '2024-01-01T10:01:00.000Z'
        }
      ];

      const messages = convertAgentResultsToMessages(agentResults, 'project-123');

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Hello');
      expect(messages[0].role).toBe('USER');
      expect(messages[1].content).toBe('Hi there!');
      expect(messages[1].role).toBe('ASSISTANT');
    });
  });

  describe('Message Type Detection', () => {
    it('should detect AGENT_QUESTION correctly', () => {
      const questionResult: AgentResult = {
        output: [{
          type: 'text',
          role: 'assistant',
          content: 'What is your restaurant name?'
        }],
        agentName: 'business-info-gatherer-agent',
        toolCalls: [],
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      const messageData = convertAgentResultToMessage(questionResult, 'project-123');
      expect(messageData.type).toBe('AGENT_QUESTION');
    });

    it('should detect ERROR correctly', () => {
      const errorResult: AgentResult = {
        output: [{
          type: 'text',
          role: 'assistant',
          content: 'An error occurred'
        }],
        agentName: 'code-agent',
        toolCalls: [],
        timestamp: '2024-01-01T10:00:00.000Z',
        error: 'Something went wrong'
      };

      const messageData = convertAgentResultToMessage(errorResult, 'project-123');
      expect(messageData.type).toBe('ERROR');
    });

    it('should default to RESULT type', () => {
      const normalResult: AgentResult = {
        output: [{
          type: 'text',
          role: 'assistant',
          content: 'Task completed successfully.'
        }],
        agentName: 'code-agent',
        toolCalls: [],
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      const messageData = convertAgentResultToMessage(normalResult, 'project-123');
      expect(messageData.type).toBe('RESULT');
    });
  });

});

/**
 * Manual Integration Test Instructions
 * 
 * Since these tests mock the database, here are instructions for manual testing:
 * 
 * 1. Enable history in .env: ENABLE_AGENTKIT_HISTORY=true
 * 2. Start the application: npm run dev
 * 3. Create a new project and have a conversation
 * 4. Check the console logs for history adapter messages
 * 5. Verify messages are saved correctly in the database
 * 6. Start a new conversation in the same project
 * 7. Verify history is loaded correctly (should see "Loading conversation history" logs)
 * 8. Disable history and verify fallback behavior still works
 * 
 * Expected Behavior:
 * - With history enabled: Previous conversation should be loaded automatically
 * - With history disabled: Should work exactly as before (legacy mode)
 * - Conversion errors should be handled gracefully with fallback content
 */