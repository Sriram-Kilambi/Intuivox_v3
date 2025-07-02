import { Card } from "@/components/ui/card";
import { Fragment, MessageRole, MessageType } from "@/generated/prisma";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ChevronRightIcon, Code2Icon, HelpCircleIcon } from "lucide-react";
import Image from "next/image";

interface MessageCardProps {
  content: string;
  role: MessageRole;
  fragment: Fragment | null;
  createdAt: Date;
  isActiveFragment: boolean;
  onFragmentClick: (fragment: Fragment) => void;
  type: MessageType;
  metadata?: any;
  isPartOfThread?: boolean;
  threadStep?: number;
  totalInThread?: number;
}

interface UserMessageProps {
  content: string;
  isPartOfThread?: boolean;
  threadStep?: number;
  totalInThread?: number;
}

interface AssistantMessageProps {
  content: string;
  fragment: Fragment | null;
  createdAt: Date;
  isActiveFragment: boolean;
  onFragmentClick: (fragment: Fragment) => void;
  type: MessageType;
  metadata?: any;
  isPartOfThread?: boolean;
  threadStep?: number;
  totalInThread?: number;
}

interface FragmentCardProps {
  fragment: Fragment;
  isActiveFragment: boolean;
  onFragmentClick: (fragment: Fragment) => void;
}

const FragmentCard = ({
  fragment,
  isActiveFragment,
  onFragmentClick,
}: FragmentCardProps) => {
  return (
    <button
      className={cn(
        "flex items-start text-start gap-2 border rounded-lg bg-muted w-fit p-3 hover:bg-secondary transition-colors",
        isActiveFragment &&
          "bg-primary text-primary-foreground border-primary hover:bg-primary"
      )}
      onClick={() => onFragmentClick(fragment)}
    >
      <Code2Icon className="size-4 mt-0.5" />
      <div className="flex flex-col flex-1">
        <span className="text-sm font-medium line-clamp-1">
          {fragment.title}
        </span>
        <span className="text-sm">Preview</span>
      </div>
      <div className="flex items-center justify-center mt-0.5">
        <ChevronRightIcon className="size-4" />
      </div>
    </button>
  );
};

const ThreadConnector = ({
  position,
}: {
  position: "start" | "middle" | "end";
}) => {
  if (position === "middle") {
    return (
      <div className="absolute left-[26px] top-0 bottom-0 w-0.5 bg-muted-foreground/20"></div>
    );
  } else if (position === "start") {
    return (
      <div className="absolute left-[26px] top-1/2 bottom-0 w-0.5 bg-muted-foreground/20"></div>
    );
  } else if (position === "end") {
    return (
      <div className="absolute left-[26px] top-0 bottom-1/2 w-0.5 bg-muted-foreground/20"></div>
    );
  }
  return null;
};

const AssistantMessage = ({
  content,
  fragment,
  createdAt,
  isActiveFragment,
  onFragmentClick,
  type,
  metadata,
  isPartOfThread,
  threadStep = 0,
  totalInThread = 1,
}: AssistantMessageProps) => {
  const isQuestion = type === "QUESTION";
  const step = metadata?.step || 0;

  // Determine thread position
  let threadPosition: "start" | "middle" | "end" | null = null;
  if (isPartOfThread) {
    if (threadStep === 0) threadPosition = "start";
    else if (threadStep === totalInThread - 1) threadPosition = "end";
    else threadPosition = "middle";
  }

  return (
    <div
      className={cn(
        "flex flex-col group px-2 pb-4 relative",
        type === "ERROR" && "text-red-700 dark:text-red-500",
        isQuestion && "text-primary"
      )}
    >
      {isPartOfThread && threadPosition && (
        <ThreadConnector position={threadPosition} />
      )}

      <div className="flex items-center gap-2 pl-2 mb-2">
        <Image
          src="/logo.svg"
          alt="Intuivox"
          width={18}
          height={18}
          className="shrink-0"
        />
        <span className="text-sm font-medium">
          Intuivox{" "}
          {isQuestion && step > 0
            ? `(question ${step})`
            : isQuestion
            ? "(asking)"
            : ""}
        </span>
        <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {format(createdAt, "HH:mm 'on' MMM dd, yyyy")}
        </span>
      </div>
      <div className="pl-8.5 flex flex-col gap-y-4">
        <div
          className={cn(
            "flex items-start gap-2",
            isQuestion &&
              "bg-primary/5 p-3 rounded-lg border-l-2 border-primary"
          )}
        >
          {isQuestion && (
            <HelpCircleIcon className="size-4 mt-1 shrink-0 text-primary" />
          )}
          <span>{content}</span>
        </div>
        {fragment && type === "RESULT" && (
          <FragmentCard
            fragment={fragment}
            isActiveFragment={isActiveFragment}
            onFragmentClick={onFragmentClick}
          />
        )}
      </div>
    </div>
  );
};

const UserMessage = ({
  content,
  isPartOfThread,
  threadStep = 0,
  totalInThread = 1,
}: UserMessageProps) => {
  // Determine thread position
  let threadPosition: "start" | "middle" | "end" | null = null;
  if (isPartOfThread) {
    if (threadStep === 0) threadPosition = "start";
    else if (threadStep === totalInThread - 1) threadPosition = "end";
    else threadPosition = "middle";
  }

  return (
    <div className="flex justify-end pb-4 pr-2 pl-10 relative">
      {isPartOfThread && threadPosition && (
        <ThreadConnector position={threadPosition} />
      )}
      <Card className="rounded-lg bg-muted p-3 shadow-none border-none max-w-[80%] break-words">
        {content}
      </Card>
    </div>
  );
};

export const MessageCard = ({
  content,
  role,
  fragment,
  createdAt,
  isActiveFragment,
  onFragmentClick,
  type,
  metadata,
  isPartOfThread,
  threadStep,
  totalInThread,
}: MessageCardProps) => {
  if (role === "ASSISTANT") {
    return (
      <AssistantMessage
        content={content}
        fragment={fragment}
        createdAt={createdAt}
        isActiveFragment={isActiveFragment}
        onFragmentClick={onFragmentClick}
        type={type}
        metadata={metadata}
        isPartOfThread={isPartOfThread}
        threadStep={threadStep}
        totalInThread={totalInThread}
      />
    );
  }

  return (
    <UserMessage
      content={content}
      isPartOfThread={isPartOfThread}
      threadStep={threadStep}
      totalInThread={totalInThread}
    />
  );
};
