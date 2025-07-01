"use client";

import Link from "next/link";
import Image from "next/image";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  useAuth,
} from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { UserControl } from "@/components/user-control";
import { useScroll } from "@/hooks/use-scroll";
import { cn } from "@/lib/utils";
import { CrownIcon } from "lucide-react";

export const Navbar = () => {
  const scrolled = useScroll();
  const { has } = useAuth();
  const hasProAccess = has?.({ plan: "pro" });

  return (
    <nav
      className={cn(
        "p-4 bg-transparent fixed top-0 left-0 right-0 z-50 transition-all duration-200 border-b border-transparent",
        scrolled && "bg-background border-border"
      )}
    >
      <div className="max-w-5xl mx-auto w-full flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.svg" alt="logo" width={24} height={24} />
          <span className="font-semibold text-lg">Intuivox</span>
        </Link>
        <SignedOut>
          <div className="flex gap-2">
            <SignUpButton>
              <Button variant="outline" size="sm">
                Sign up
              </Button>
            </SignUpButton>
            <SignInButton>
              <Button size="sm">Sign in</Button>
            </SignInButton>
          </div>
        </SignedOut>
        <SignedIn>
          {hasProAccess && (
            <span className="flex flex-row gap-2 text-yellow-600 font-semibold">
              <CrownIcon /> Pro
            </span>
          )}
          <UserControl showName />
        </SignedIn>
      </div>
    </nav>
  );
};
