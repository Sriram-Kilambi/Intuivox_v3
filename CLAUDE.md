# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Commands
- `npm run dev` - Start development server (with Turbopack)
- `npm run build` - Build production bundle
- `npm run start` - Start production server
- `npm run lint` - Run ESLint checks
- `npm run postinstall` - Regenerate Prisma client (runs automatically after install)

### Database Commands
- `npx prisma generate` - Generate Prisma client after schema changes
- `npx prisma db push` - Push schema changes to database
- `npx prisma studio` - Open Prisma Studio for database management

## Architecture Overview

### Tech Stack
- **Framework**: Next.js 15.3.4 with App Router
- **Language**: TypeScript with strict mode
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Clerk
- **UI**: shadcn/ui components with Radix UI primitives
- **Styling**: Tailwind CSS 4.x
- **State Management**: tRPC for API layer, TanStack Query for client state
- **Background Jobs**: Inngest for async processing
- **Code Execution**: E2B sandbox environments

### Project Structure

The application is structured as a modular Next.js app with feature-based organization:

```
src/
├── app/                    # Next.js App Router pages
│   ├── (home)/            # Home page group with auth pages
│   ├── api/               # API routes (tRPC, Inngest, user questions)
│   └── projects/          # Dynamic project pages
├── components/            # Shared UI components
│   ├── ui/               # shadcn/ui components (auto-generated)
│   └── [other shared]    # Custom shared components
├── modules/              # Feature-based modules
│   ├── home/             # Home page functionality
│   ├── projects/         # Project management
│   ├── messages/         # Message handling
│   └── usage/            # Usage tracking
├── inngest/              # Background job functions
├── trpc/                 # tRPC configuration and routers
├── lib/                  # Shared utilities and database
└── generated/            # Prisma generated client
```

### Core Application Flow

1. **Authentication**: Users sign in via Clerk, which provides `userId` for all operations
2. **Project Creation**: Users create projects through the home page form
3. **AI Interaction**: Users interact with multi-agent AI system that:
   - Gathers business information via conversation
   - Generates code in E2B sandbox environments  
   - Creates web fragments (live preview + code files)
4. **Message System**: All interactions stored as messages with roles (USER/ASSISTANT) and types (RESULT/ERROR/AGENT_QUESTION)
5. **Fragment Management**: Each AI-generated result creates a Fragment with sandbox URL, title, and file contents

### Multi-Agent System

The application uses Inngest Agent Kit for complex AI workflows:

- **Business Info Gatherer Agent**: Collects business details through conversational Q&A
- **Code Agent**: Generates Next.js applications in E2B sandboxes with specific constraints
- **Fragment Title Generator**: Creates descriptive titles for generated fragments
- **Response Generator**: Formats user-friendly responses

### Database Schema

Key models in Prisma schema:
- `Project`: User-owned containers for conversations
- `Message`: Individual conversation messages with role/type classification  
- `Fragment`: Generated code artifacts with sandbox URLs and file contents
- `Usage`: Rate limiting and usage tracking

### tRPC API Structure

The API is organized into feature-based routers:
- `messages.*`: Message CRUD operations
- `projects.*`: Project management  
- `usage.*`: Usage tracking and limits

## Development Guidelines

### File Conventions
- Use `@/` path alias for all imports from `src/`
- shadcn/ui components are in `@/components/ui/`
- Generated Prisma client is in `@/generated/prisma/`
- Feature modules follow structure: `modules/[feature]/server/` and `modules/[feature]/ui/`

### Key Dependencies
- Authentication is handled entirely by Clerk - never implement custom auth
- All database operations use Prisma with the generated client
- UI components should use shadcn/ui primitives with Tailwind CSS
- Background jobs must use Inngest functions, not direct API calls
- Code execution happens in E2B sandboxes, not locally

### Environment Requirements
- `DATABASE_URL` for PostgreSQL connection
- Clerk authentication keys
- Inngest signing key and event key  
- E2B API token for sandbox management

### Development Notes
- Prisma client is generated to `src/generated/prisma/` (not default location)
- ESLint ignores generated files via `ignores: ["**/generated/*"]`
- TypeScript excludes problematic chart component: `src/components/ui/chart.tsx`
- The app uses strict TypeScript with Next.js plugin configuration

## Sandbox System

The application creates isolated Next.js environments for AI-generated code:
- Uses E2B Code Interpreter sandboxes  
- Template: "intuivox-nextjs-test-2"
- 30-minute timeout with auto-reload on expiry
- Files are synchronized between agent state and sandbox filesystem
- Live preview available via sandbox-provided URLs

## Background Processing

Inngest handles async operations:
- `code-agent/run`: Main AI workflow orchestration
- `app/user-agent-question`: Handles AI-to-user questions
- `app/user-agent-response`: Processes user responses to AI questions

The system supports complex conversational flows where AI agents can pause execution to ask users questions and wait for responses.