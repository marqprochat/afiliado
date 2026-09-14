export function PhasePlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="mx-auto mt-24 max-w-md rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="mb-2 text-xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">
        Disponível na fase {phase}. Esta área será liberada nas próximas etapas do projeto.
      </p>
    </div>
  );
}
