import Sandbox from "@e2b/code-interpreter";
import { AgentResult, TextMessage } from "@inngest/agent-kit";
import { SANDBOX_TIMEOUT } from "./constants";

export async function getSandbox(sandboxId: string) {
  const sandbox = await Sandbox.connect(sandboxId);
  await sandbox.setTimeout(SANDBOX_TIMEOUT); // Keep sandbox alive for 30 mins
  return sandbox;
}

export async function getSandboxWithFallback(
  sandboxId: string,
  files: { [path: string]: string } = {}
): Promise<{ sandbox: Sandbox; newSandboxId?: string }> {
  try {
    // Try to connect to existing sandbox
    const sandbox = await Sandbox.connect(sandboxId);
    await sandbox.setTimeout(SANDBOX_TIMEOUT);
    return { sandbox };
  } catch (error) {
    console.log(`Sandbox ${sandboxId} expired or unavailable, creating new one:`, error);
    
    // Create new sandbox if the old one is expired
    const newSandbox = await Sandbox.create("intuivox-nextjs-test-2");
    await newSandbox.setTimeout(SANDBOX_TIMEOUT);
    
    // Recreate all files from state
    for (const [path, content] of Object.entries(files)) {
      try {
        await newSandbox.files.write(path, content);
      } catch (fileError) {
        console.error(`Failed to recreate file ${path}:`, fileError);
      }
    }
    
    return { 
      sandbox: newSandbox, 
      newSandboxId: newSandbox.sandboxId 
    };
  }
}

export function lastAssistantTextMessageContent(result: AgentResult) {
  const lastAssistantTextMessageIndex = result.output.findLastIndex(
    (message) => message.role === "assistant"
  );

  const message = result.output[lastAssistantTextMessageIndex] as
    | TextMessage
    | undefined;

  return message?.content
    ? typeof message.content === "string"
      ? message.content
      : message.content.map((c) => c.text).join("")
    : undefined;
}
