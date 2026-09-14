'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/app-shell/status-pill';
import type { WaSession } from '@/lib/types';

export interface SessionCardProps {
  session: WaSession;
  onConnect: (id: string, body: { mode: 'qr' | 'pair'; phone?: string }) => void;
  onDisconnect: (id: string) => void;
  onLogout: (id: string) => void;
  onDelete: (id: string) => void;
  onSync: (id: string) => void;
}

export function SessionCard({
  session: s,
  onConnect,
  onDisconnect,
  onLogout,
  onDelete,
  onSync,
}: SessionCardProps) {
  const [pairOpen, setPairOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const idle = s.status === 'DISCONNECTED' || s.status === 'LOGGED_OUT';
  const pending = s.status === 'CONNECTING' || s.status === 'NEEDS_QR';

  return (
    <Card className="border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{s.label}</h3>
          <p className="text-sm text-muted-foreground">
            {s.phone ? `+${s.phone}` : 'Sem número vinculado'}
          </p>
        </div>
        <StatusPill label={s.status} status={s.status} />
      </div>

      {s.status === 'NEEDS_QR' && s.lastQr && !s.pairCode && (
        <div
          className="mb-4 flex flex-col items-center gap-2 rounded-lg bg-white p-4"
          data-testid="qr-code"
        >
          <QRCodeSVG value={s.lastQr} size={220} />
          <p className="text-xs text-slate-700">
            Abra o WhatsApp → Dispositivos conectados → Conectar dispositivo
          </p>
        </div>
      )}
      {s.status === 'NEEDS_QR' && s.pairCode && (
        <div className="mb-4 rounded-lg bg-surface-2 p-4 text-center">
          <p className="mb-1 text-xs text-muted-foreground">
            Digite este código no WhatsApp → Conectar com número de telefone
          </p>
          <p className="font-mono text-3xl tracking-widest text-brand">{s.pairCode}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {idle && (
          <>
            <Button
              size="sm"
              className="bg-brand text-white hover:bg-brand/90"
              onClick={() => onConnect(s.id, { mode: 'qr' })}
            >
              Conectar (QR)
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPairOpen(true)}>
              Conectar (código)
            </Button>
          </>
        )}
        {pending && (
          <Button size="sm" variant="secondary" onClick={() => onDisconnect(s.id)}>
            Cancelar
          </Button>
        )}
        {s.status === 'CONNECTED' && (
          <>
            <Button
              size="sm"
              className="bg-brand text-white hover:bg-brand/90"
              onClick={() => onSync(s.id)}
            >
              Sincronizar grupos
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDisconnect(s.id)}>
              Desconectar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onLogout(s.id)}>
              Sair da conta
            </Button>
          </>
        )}
        {idle && (
          <Button size="sm" variant="ghost" className="text-red-300" onClick={() => onDelete(s.id)}>
            Excluir
          </Button>
        )}
      </div>

      <Dialog open={pairOpen} onOpenChange={setPairOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar com código</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Número com DDI e DDD, só dígitos (ex.: 5511999999999).
          </p>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="5511999999999"
          />
          <Button
            disabled={phone.length < 10}
            onClick={() => {
              onConnect(s.id, { mode: 'pair', phone });
              setPairOpen(false);
            }}
            className="bg-brand text-white hover:bg-brand/90"
          >
            Gerar código
          </Button>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
