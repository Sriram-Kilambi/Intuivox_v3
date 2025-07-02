import { Inngest } from "inngest";

// Create a client to send and receive events
export const inngest = new Inngest({
  id: "intuivox",
  // Explicitly set the server URL for local development
  baseUrl:
    process.env.NODE_ENV === "development"
      ? "http://localhost:8288"
      : undefined,
});
