import { ProjectForm } from "@/modules/home/ui/components/project-form";
import { ProjectsList } from "@/modules/home/ui/components/projects-list";
import Image from "next/image";

const Page = () => {
  return (
    <div className="flex flex-col max-w-5xl mx-auto w-full">
      <section className="space-y-6 py-[16vh] 2xl:py-48">
        <div className="flex flex-col items-center">
          <Image
            src="/logo.svg"
            alt="logo"
            width={50}
            height={50}
            className="hidden md:block"
          />
        </div>
        <h1 className="text-2xl md:text-5xl font-bold text-center">
          Build something with Intuivox
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground text-center">
          Create apps and websites by chatting with AI
        </p>
        <div className="max-w-3xl mx-auto w-full">
          <ProjectForm />
        </div>
      </section>
      <ProjectsList />
    </div>
  );
};

export default Page;

// "use client";

// import { Button } from "@/components/ui/button";
// import { Input } from "@/components/ui/input";
// import { useTRPC } from "@/trpc/client";
// import { useMutation } from "@tanstack/react-query";
// import { useState } from "react";
// import { toast } from "sonner";
// import { useRouter } from "next/navigation";

// const Page = () => {
//   const router = useRouter();
//   const [value, setValue] = useState("");

//   const trpc = useTRPC();

//   const createProject = useMutation(
//     trpc.projects.create.mutationOptions({
//       onSuccess: (data) => {
//         router.push(`/projects/${data.id}`);
//       },
//       onError: (error) => {
//         toast.error(error.message);
//       },
//     })
//   );

//   return (
//     <div className="h-screen w-screen flex items-center justify-center">
//       <div className="max-w-7xl mx-auto flex items-center flex-col gap-y-4 justify-center">
//         <Input value={value} onChange={(e) => setValue(e.target.value)} />
//         <Button
//           disabled={createProject.isPending}
//           onClick={() => createProject.mutate({ value: value })}
//         >
//           Submit
//         </Button>
//       </div>
//     </div>
//   );
// };

// export default Page;
