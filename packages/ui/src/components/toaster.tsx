import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { useTheme } from "../theme/theme-provider";

export { toast } from "sonner";

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <SonnerToaster
      theme={resolvedTheme}
      position="bottom-right"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "rounded-2xl! border bg-popover text-popover-foreground shadow-[var(--shadow-lift)]! font-sans",
          description: "text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
