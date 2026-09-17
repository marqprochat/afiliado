'use client';
import { useState } from 'react';
import { RuleForm } from '@/components/automations/rule-form';
import { RuleCard } from '@/components/automations/rule-card';
import { useAutomationRules } from '@/lib/queries';

export default function AutomacoesPage() {
  const { data: rules } = useAutomationRules();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Automações</h1>
        <button className="text-sm text-orange-600" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancelar' : '+ Nova automação'}
        </button>
      </div>
      {showForm && <RuleForm onCreated={() => setShowForm(false)} />}
      <div className="space-y-3">
        {rules?.map((r) => (
          <RuleCard key={r.id} rule={r} />
        ))}
        {rules?.length === 0 && !showForm && (
          <p className="text-sm text-gray-400">Nenhuma automação criada ainda.</p>
        )}
      </div>
    </div>
  );
}
