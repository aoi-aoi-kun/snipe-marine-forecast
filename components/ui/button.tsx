import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sea/45 focus-visible:ring-offset-2 focus-visible:ring-offset-paper active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-sea text-paper shadow-[0_1px_0_rgba(255,255,255,0.18)_inset] hover:bg-sea-deep",
        outline:
          "border border-line/70 bg-white/75 text-ink shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] hover:border-sea/40 hover:bg-white/95",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 px-3 text-[11px] tracking-wide",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
