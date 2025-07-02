import { useTRPC } from "@/trpc/client";
import { useEffect, useRef, useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { MessageCard } from "./message-card";
import { MessageForm } from "./message-form";
import { Fragment, MessageRole } from "@/generated/prisma";
import { MessageLoading } from "./message-loading";

interface Props {
  projectId: string;
  activeFragment: Fragment | null;
  setActiveFragment: (fragment: Fragment) => void;
}

// Group messages into conversation threads
const groupMessagesByThread = (messages: any[]) => {
  const groupedMessages = [];
  let currentThread: any[] = [];

  // Process messages to group them
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // Always add the first message
    if (i === 0) {
      currentThread.push(message);
      continue;
    }

    // Get the previous message
    const prevMessage = messages[i - 1];

    // If this is a question and the previous message is not a user response
    // or if this is a result from the assistant after the user's answer
    if (
      (message.type === "QUESTION" &&
        prevMessage.role === "ASSISTANT" &&
        prevMessage.type === "QUESTION") ||
      (message.role === "ASSISTANT" &&
        message.type === "RESULT" &&
        prevMessage.role === "USER")
    ) {
      // If we have an existing thread, push it to the groupedMessages
      if (currentThread.length > 0) {
        groupedMessages.push([...currentThread]);
      }

      // Start a new thread with this message
      currentThread = [message];
    } else {
      // Continue the current thread
      currentThread.push(message);
    }
  }

  // Add the last thread if it exists
  if (currentThread.length > 0) {
    groupedMessages.push(currentThread);
  }

  return groupedMessages;
};

export const MessagesContainer = ({
  projectId,
  activeFragment,
  setActiveFragment,
}: Props) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastAssistantMessageIdRef = useRef<string | null>(null);
  const trpc = useTRPC();
  const { data: messages } = useSuspenseQuery(
    trpc.messages.getMany.queryOptions(
      {
        projectId,
      },
      {
        refetchInterval: 5000,
      }
    )
  );

  // Group messages into conversation threads
  const groupedMessages = useMemo(
    () => groupMessagesByThread(messages),
    [messages]
  );

  useEffect(() => {
    const lastAssistantMessage = messages.findLast(
      (message) => message.role === "ASSISTANT"
    );

    if (
      lastAssistantMessage?.fragment &&
      lastAssistantMessage.id !== lastAssistantMessageIdRef.current
    ) {
      setActiveFragment(lastAssistantMessage.fragment);
      lastAssistantMessageIdRef.current = lastAssistantMessage.id;
    }
  }, [messages, setActiveFragment]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const lastMessage = messages[messages.length - 1];
  const lastAssistantMessage = messages.findLast(
    (message) => message.role === "ASSISTANT" && message.type === "QUESTION"
  );
  const isLastMessageUser = lastMessage?.role === "USER";
  const isRespondingToQuestion =
    messages.length >= 2 &&
    lastAssistantMessage &&
    isLastMessageUser &&
    new Date(lastAssistantMessage.createdAt) < new Date(lastMessage.createdAt);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="pt-2 pr-1">
          {groupedMessages.map((thread, threadIndex) => (
            <div key={`thread-${threadIndex}`} className="mb-4">
              {thread.map((message: any) => (
                <MessageCard
                  key={message.id}
                  content={message.content}
                  role={message.role}
                  fragment={message.fragment}
                  createdAt={message.createdAt}
                  isActiveFragment={activeFragment?.id === message.fragment?.id}
                  onFragmentClick={() => {
                    if (message.fragment) {
                      setActiveFragment(message.fragment);
                    }
                  }}
                  type={message.type}
                  metadata={message.metadata}
                  isPartOfThread={thread.length > 1}
                  threadStep={thread.findIndex((m: any) => m.id === message.id)}
                  totalInThread={thread.length}
                />
              ))}
            </div>
          ))}
          {isLastMessageUser && !isRespondingToQuestion && <MessageLoading />}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="relative p-3 pt-1">
        <div className="absolute -top-6 left-0 right-0 h-6 bg-gradient-to-b from-transparent to-background pointer-events-none"></div>
        <MessageForm
          projectId={projectId}
          isRespondingToQuestion={isRespondingToQuestion}
          questionId={
            isRespondingToQuestion ? lastAssistantMessage?.id : undefined
          }
        />
      </div>
    </div>
  );
};
