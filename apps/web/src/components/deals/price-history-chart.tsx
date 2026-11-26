'use client';

import React from 'react';
import { formatCurrency } from '@/lib/format';

interface HistoryPoint {
  storeName: string;
  source: string;
  price: number;
  recordedAt: string | Date;
}

interface PriceHistoryChartProps {
  history: HistoryPoint[];
  averagePrice: number;
  lowestPrice: number;
  currentPrice: number;
}

export function PriceHistoryChart({
  history,
  averagePrice,
  lowestPrice,
  currentPrice,
}: PriceHistoryChartProps) {
  if (!history || history.length === 0) {
    return (
      <div className="p-6 rounded-2xl bg-white border border-slate-200 text-center text-slate-500 text-sm">
        Monitorando histórico deste produto. As variações de preço entre lojas aparecerão aqui conforme registradas.
      </div>
    );
  }

  // Prepara dados para traçar SVG
  const prices = history.map((h) => Number(h.price));
  const minP = Math.min(...prices, currentPrice) * 0.95;
  const maxP = Math.max(...prices, currentPrice, averagePrice) * 1.05;
  const range = maxP - minP || 1;

  const width = 600;
  const height = 220;
  const paddingX = 45;
  const paddingY = 30;

  const chartW = width - paddingX * 2;
  const chartH = height - paddingY * 2;

  const points = history.map((h, i) => {
    const x = paddingX + (i / Math.max(1, history.length - 1)) * chartW;
    const y = paddingY + chartH - ((h.price - minP) / range) * chartH;
    return { x, y, price: h.price, store: h.storeName, date: new Date(h.recordedAt) };
  });

  const pathD = points.reduce((acc, p, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`, '');
  const areaD = `${pathD} L ${points[points.length - 1]?.x ?? width} ${height - paddingY} L ${paddingX} ${height - paddingY} Z`;

  // Posição Y da média
  const avgY = paddingY + chartH - ((averagePrice - minP) / range) * chartH;

  return (
    <div className="w-full bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <div>
          <h4 className="text-slate-900 font-bold text-base">
            Histórico e média de preço
          </h4>
          <p className="text-slate-500 text-xs mt-0.5">
            Acompanhamento em tempo real entre todas as lojas monitoradas
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-semibold tabular-nums">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
            <span className="text-slate-700">Menor: {formatCurrency(lowestPrice)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-sky-600" />
            <span className="text-slate-600">Média: {formatCurrency(averagePrice)}</span>
          </div>
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto min-w-[420px] overflow-visible"
        >
          <defs>
            <linearGradient id="chartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#059669" stopOpacity="0.16" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line
            x1={paddingX}
            y1={paddingY}
            x2={width - paddingX}
            y2={paddingY}
            stroke="#e2e8f0"
            strokeDasharray="3 3"
          />
          <line
            x1={paddingX}
            y1={height - paddingY}
            x2={width - paddingX}
            y2={height - paddingY}
            stroke="#e2e8f0"
          />

          {/* Linha de Média Histórica */}
          {avgY >= paddingY && avgY <= height - paddingY && (
            <g>
              <line
                x1={paddingX}
                y1={avgY}
                x2={width - paddingX}
                y2={avgY}
                stroke="#0284c7"
                strokeWidth="1.5"
                strokeDasharray="4 4"
                opacity="0.85"
              />
              <text
                x={width - paddingX + 5}
                y={avgY + 4}
                fill="#0284c7"
                fontSize="10"
                fontWeight="600"
                fontFamily="sans-serif"
              >
                Média
              </text>
            </g>
          )}

          {/* Área sombreada */}
          {points.length > 1 && (
            <path d={areaD} fill="url(#chartGrad)" />
          )}

          {/* Linha da curva de preço */}
          {points.length > 1 && (
            <path
              d={pathD}
              fill="none"
              stroke="#059669"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Pontos de verificação com tooltip nativo */}
          {points.map((p, idx) => (
            <g key={idx} className="group cursor-pointer">
              <circle
                cx={p.x}
                cy={p.y}
                r="4.5"
                className="fill-emerald-600 stroke-white stroke-2 group-hover:r-6 transition-all duration-150"
              />
              <title>{`${p.store}: ${formatCurrency(p.price)} em ${p.date.toLocaleDateString('pt-BR')}`}</title>
            </g>
          ))}
        </svg>
      </div>

      <div className="flex justify-between items-center text-[11px] text-slate-400 mt-2 px-2">
        <span>Primeiro registro</span>
        <span>Última verificação</span>
      </div>
    </div>
  );
}
