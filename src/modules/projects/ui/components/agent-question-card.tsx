import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpIcon, Loader2Icon } from "lucide-react";
import Image from "next/image";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Form, FormField } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { useTRPC } from "@/trpc/client";
import { cn } from "@/lib/utils";

interface AgentQuestionCardProps {
  content: string;
  createdAt: Date;
  projectId: string;
}

const responseSchema = z.object({
  answer: z.string().min(1, { message: "Answer is required" }),
});

export const AgentQuestionCard = ({
  content,
  createdAt,
  projectId,
}: AgentQuestionCardProps) => {
  const [isResponding, setIsResponding] = useState(false);
  const queryClient = useQueryClient();
  const trpc = useTRPC();

  const form = useForm<z.infer<typeof responseSchema>>({
    resolver: zodResolver(responseSchema),
    defaultValues: {
      answer: "",
    },
  });

  const respondToAgent = useMutation(
    trpc.messages.respondToAgent.mutationOptions({
      onSuccess: () => {
        form.reset();
        setIsResponding(false);
        queryClient.invalidateQueries(
          trpc.messages.getMany.queryOptions({
            projectId,
          })
        );
        toast.success("Response sent to agent");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    })
  );

  const onSubmit = async (values: z.infer<typeof responseSchema>) => {
    await respondToAgent.mutateAsync({
      answer: values.answer,
      projectId,
    });
  };

  const isPending = respondToAgent.isPending;
  const isButtonDisabled = isPending || !form.formState.isValid;

  return (
    <div className="flex flex-col group px-2 pb-4">
      <div className="flex items-center gap-2 pl-2 mb-2">
        <Image
          src="/logo.svg"
          alt="Intuivox"
          width={18}
          height={18}
          className="shrink-0"
        />
        <span className="text-sm font-medium">Intuivox</span>
        <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {format(createdAt, "HH:mm 'on' MMM dd, yyyy")}
        </span>
      </div>
      <div className="pl-8.5 flex flex-col gap-y-4">
        <div className="flex flex-col gap-2">
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            🤔 I have a question for you:
          </span>
          <span>{content}</span>
        </div>

        {!isResponding ? (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setIsResponding(true)}
          >
            💬 Answer this question
          </Button>
        ) : (
          <Card className="p-3 border border-amber-200 dark:border-amber-800">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-3"
              >
                <FormField
                  control={form.control}
                  name="answer"
                  render={({ field }) => (
                    <Textarea
                      {...field}
                      disabled={isPending}
                      placeholder="Type your answer here..."
                      className="min-h-[80px] resize-none"
                      autoFocus
                    />
                  )}
                />
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsResponding(false);
                      form.reset();
                    }}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={isButtonDisabled}
                    className={cn(
                      "gap-2",
                      isButtonDisabled && "bg-muted-foreground border"
                    )}
                  >
                    {isPending ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <ArrowUpIcon className="size-4" />
                    )}
                    Send Answer
                  </Button>
                </div>
              </form>
            </Form>
          </Card>
        )}
      </div>
    </div>
  );
};
