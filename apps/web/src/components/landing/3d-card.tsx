'use client';

import React, { useState, useRef } from 'react';

interface Card3DProps {
  children: React.ReactNode;
  className?: string;
  glowColor?: string;
}

export function Card3D({ children, className = '', glowColor = 'rgba(99, 102, 241, 0.15)' }: Card3DProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
  const [glarePosition, setGlarePosition] = useState({ x: 50, y: 50, opacity: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const rotateX = ((y - centerY) / centerY) * -10; // Max 10 deg tilt
    const rotateY = ((x - centerX) / centerX) * 10;

    setTransform(`perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`);

    const glareX = (x / rect.width) * 100;
    const glareY = (y / rect.height) * 100;
    setGlarePosition({ x: glareX, y: glareY, opacity: 0.4 });
  };

  const handleMouseLeave = () => {
    setTransform('perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)');
    setGlarePosition((prev) => ({ ...prev, opacity: 0 }));
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`relative transition-transform duration-200 ease-out transform-gpu will-change-transform ${className}`}
      style={{
        transform,
        transformStyle: 'preserve-3d',
      }}
    >
      {/* Dynamic Glow Shadow */}
      <div
        className="absolute -inset-0.5 rounded-2xl blur-lg transition duration-300 opacity-0 group-hover:opacity-100 pointer-events-none -z-10"
        style={{ background: glowColor }}
      />

      {/* 3D Dynamic Glare Overlay */}
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none z-10 transition-opacity duration-300"
        style={{
          background: `radial-gradient(circle at ${glarePosition.x}% ${glarePosition.y}%, rgba(255, 255, 255, 0.25) 0%, transparent 60%)`,
          opacity: glarePosition.opacity,
        }}
      />

      {/* Card Body */}
      {children}
    </div>
  );
}
