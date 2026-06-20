import { cn } from "@/lib/utils";

interface ErrorAlertProps {
  message: string | null;
  className?: string;
}

export function ErrorAlert({ message, className }: ErrorAlertProps) {
  if (!message) return null;
  return (
    <div
      className={cn(
        "text-sm text-destructive bg-destructive/10 p-3 rounded-md",
        className
      )}
    >
      {message}
    </div>
  );
}
