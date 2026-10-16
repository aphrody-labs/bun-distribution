import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";

interface AdminCardProps extends React.ComponentPropsWithoutRef<typeof Card> {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  contentClassName?: string;
}

export function AdminCard({
  title,
  description,
  icon,
  className,
  contentClassName,
  children,
  ...props
}: AdminCardProps) {
  return (
    <Card className={cn(className)} {...props}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs text-muted-foreground">{description}</CardDescription>}
      </CardHeader>
      <CardContent className={cn("pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
