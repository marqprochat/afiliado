'use client';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  /** Quando definido, o botão só libera depois de digitar exatamente este texto. */
  confirmPhrase?: string;
  pending?: boolean;
  onConfirm: () => void;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  confirmPhrase,
  pending,
  onConfirm,
}: ConfirmActionDialogProps) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);

  const locked = !!confirmPhrase && typed.trim().toUpperCase() !== confirmPhrase.toUpperCase();

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 text-sm text-muted-foreground">{children}</div>

        {confirmPhrase && (
          <div className="space-y-1.5">
            <div className="text-xs text-muted-foreground">
              Digite <strong className="text-foreground">{confirmPhrase}</strong> para confirmar:
            </div>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmPhrase}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !locked && !pending) onConfirm();
              }}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={onConfirm} disabled={locked || pending}>
            {pending ? 'Processando...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
