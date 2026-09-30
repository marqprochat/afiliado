'use client';
import { MessageSquare } from 'lucide-react';
import { buildGroupName, type GroupTextPosition } from '@afilados/shared';

interface GroupLinkPreviewProps {
  baseName: string;
  customText?: string;
  textPosition: GroupTextPosition;
  numberPrefix: string;
  number: number;
  groupImageBase64?: string | null;
}

export function GroupLinkPreview({
  baseName,
  customText,
  textPosition,
  numberPrefix,
  number,
  groupImageBase64,
}: GroupLinkPreviewProps) {
  const generatedName = buildGroupName({
    baseName: baseName || 'Nome do Grupo',
    customText,
    textPosition,
    numberPrefix: numberPrefix || '#',
    number,
  });

  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <MessageSquare className="h-3.5 w-3.5 text-brand" />
        Prévia ao vivo do Nome e Foto no WhatsApp
      </div>
      <div className="mt-2 flex items-center gap-3 rounded-md bg-surface p-2.5 border border-border">
        {groupImageBase64 ? (
          <img
            src={groupImageBase64}
            alt="Foto do Grupo"
            className="h-10 w-10 shrink-0 rounded-full object-cover border border-border ring-1 ring-brand/30"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/20 text-brand font-bold text-xs">
            WA
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-sm text-foreground">{generatedName}</div>
          <div className="text-xs text-muted-foreground">
            {number}º grupo da rotação (exibição padrão)
          </div>
        </div>
      </div>
    </div>
  );
}
