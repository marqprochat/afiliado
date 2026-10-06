'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function ThreeCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 6;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 3D Objects Group
    const group = new THREE.Group();
    scene.add(group);

    // Main 3D Glowing Wireframe Core (Icosahedron)
    const geometry = new THREE.IcosahedronGeometry(2.2, 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x6366f1,
      wireframe: true,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x4f46e5,
      emissiveIntensity: 0.4,
    });
    const coreMesh = new THREE.Mesh(geometry, material);
    group.add(coreMesh);

    // Inner Glowing Solid Core
    const innerGeo = new THREE.IcosahedronGeometry(1.4, 1);
    const innerMat = new THREE.MeshPhongMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.6,
      shininess: 100,
      transparent: true,
      opacity: 0.85,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    group.add(innerMesh);

    // Outer Orbiting Ring
    const ringGeo = new THREE.TorusGeometry(3.3, 0.04, 16, 100);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xec4899,
      wireframe: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 3;
    group.add(ringMesh);

    // Particle Cloud
    const particleCount = 200;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePositions[i] = (Math.random() - 0.5) * 16;
      particlePositions[i + 1] = (Math.random() - 0.5) * 16;
      particlePositions[i + 2] = (Math.random() - 0.5) * 16;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0xa855f7,
      size: 0.05,
      transparent: true,
      opacity: 0.75,
    });
    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x6366f1, 2, 20);
    pointLight1.position.set(5, 5, 5);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x06b6d4, 2, 20);
    pointLight2.position.set(-5, -5, -2);
    scene.add(pointLight2);

    // Mouse Parallax Interaction
    let mouseX = 0;
    let mouseY = 0;
    let targetX = 0;
    let targetY = 0;

    const onMouseMove = (event: MouseEvent) => {
      const windowHalfX = window.innerWidth / 2;
      const windowHalfY = window.innerHeight / 2;
      mouseX = (event.clientX - windowHalfX) / 100;
      mouseY = (event.clientY - windowHalfY) / 100;
    };

    window.addEventListener('mousemove', onMouseMove);

    // Resize Handler
    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };

    window.addEventListener('resize', onResize);

    // Animation Loop
    let animationFrameId: number;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Rotate 3D meshes smoothly
      coreMesh.rotation.y += 0.005;
      coreMesh.rotation.x += 0.002;
      innerMesh.rotation.y -= 0.008;
      ringMesh.rotation.z += 0.004;
      particleSystem.rotation.y += 0.001;

      // Mouse smooth interpolation (lerp)
      targetX += (mouseX - targetX) * 0.05;
      targetY += (mouseY - targetY) * 0.05;

      group.rotation.y = targetX * 0.5;
      group.rotation.x = -targetY * 0.5;

      renderer.render(scene, camera);
    };

    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      innerGeo.dispose();
      innerMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-[380px] sm:h-[480px] lg:h-[540px] flex items-center justify-center overflow-hidden">
      {/* Background glow behind 3D Canvas */}
      <div className="absolute w-72 h-72 sm:w-96 sm:h-96 bg-indigo-600/20 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse" />
      <div className="absolute w-60 h-60 sm:w-80 sm:h-80 bg-cyan-500/15 rounded-full blur-[90px] pointer-events-none -z-10 translate-x-20 translate-y-20" />
      
      {/* Three.js Canvas Container */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
    </div>
  );
}
