'use client';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useGroups } from '@/lib/queries';

const PREFIX = { GROUP: '[GRUPO]', COMMUNITY: '[COMUNIDADE]', CHANNEL: '[CANAL]' } as const;

export function GroupsList({ sessionId }: { sessionId: string }) {
  const { data, isLoading } = useGroups(sessionId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando grupos…</p>;
  if (!data?.length)
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum grupo sincronizado. Conecte e clique em “Sincronizar grupos”.
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Grupo</TableHead>
          <TableHead className="text-right">Membros</TableHead>
          <TableHead>Permissão</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((g) => (
          <TableRow key={g.jid}>
            <TableCell>
              <span className="mr-2 text-xs text-muted-foreground">{PREFIX[g.kind]}</span>
              {g.name}
            </TableCell>
            <TableCell className="text-right">{g.memberCount}</TableCell>
            <TableCell>
              {g.botIsAdmin ? (
                <Badge className="bg-brand/20 text-brand">Admin</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">membro</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
