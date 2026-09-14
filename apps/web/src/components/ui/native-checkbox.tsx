import { cn } from '@/lib/utils';

export function NativeCheckbox({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn('h-4 w-4 cursor-pointer rounded border-border accent-brand', className)}
      {...props}
    />
  );
}
