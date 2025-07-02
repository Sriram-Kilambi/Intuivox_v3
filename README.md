# Intuivox Website Builder

This is a website builder prototype built with Next.js and Inngest.

## Human-in-the-Loop Business Information Gathering

Intuivox includes a Human-in-the-Loop system for gathering business information from users before generating website code. The workflow works as follows:

1. The Business Info Gatherer Agent asks the user a question
2. The workflow pauses and waits for the user's response
3. When the user responds, an event is sent to Inngest
4. Inngest processes the response and continues the workflow
5. The agent analyzes the response and either asks another question or proceeds with code generation

### Technical Implementation

- Uses Inngest's `waitForEvent` functionality to pause workflows and wait for user input
- Messages with type `QUESTION` are visually distinguished in the UI
- User responses are sent back to Inngest via the `project/user.response` event
- The Business Info Gatherer Agent stores gathered information in the shared agent state

### Testing the Feature

1. Start a new project in the UI
2. The agent will ask questions to gather business information
3. Answer each question in the response input
4. Once all required information is gathered, the code generation begins

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

## Technologies used in this app

- Next.js
- Inngest
- AgentKit
- E2B Sandbox
- Tailwind CSS
- Prisma ORM
- PostgreSQL
- TypeScript
