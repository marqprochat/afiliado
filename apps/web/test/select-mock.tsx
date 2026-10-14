// Substituto leve de '@/components/ui/select' para testes em jsdom: o Select do base-ui só
// seleciona com eventos de ponteiro e a consulta por papel é lenta. Aqui o clique no item basta.
import * as React from 'react';

interface SelectItemData {
  value: string;
  label: string;
}

const Ctx = React.createContext<{
  value: string;
  items: SelectItemData[];
  onValueChange: (value: string) => void;
}>({ value: '', items: [], onValueChange: () => {} });

export function Select({
  value,
  items = [],
  onValueChange,
  children,
}: {
  value: string;
  items?: SelectItemData[];
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={{ value, items, onValueChange }}>{children}</Ctx.Provider>;
}

export function SelectTrigger({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" role="combobox" {...props}>
      {children}
    </button>
  );
}

export function SelectValue() {
  const { value, items } = React.useContext(Ctx);
  return <span>{items.find((i) => i.value === value)?.label ?? value}</span>;
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  return <div role="listbox">{children}</div>;
}

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  const ctx = React.useContext(Ctx);
  return (
    <div role="option" aria-selected={ctx.value === value} onClick={() => ctx.onValueChange(value)}>
      {children}
    </div>
  );
}
