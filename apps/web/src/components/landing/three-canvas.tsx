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
    camera.position.z = 5.8;

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // 3D Objects Group
    const group = new THREE.Group();
    scene.add(group);

    // Main 3D Glowing Wireframe Core (Dudu Rocha Electric Green #27c40b)
    const geometry = new THREE.IcosahedronGeometry(2.1, 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x27c40b,
      wireframe: true,
      roughness: 0.15,
      metalness: 0.9,
      emissive: 0x1da308,
      emissiveIntensity: 0.5,
    });
    const coreMesh = new THREE.Mesh(geometry, material);
    group.add(coreMesh);

    // Inner Glowing Solid Cyber Core (Cyan & Emerald)
    const innerGeo = new THREE.IcosahedronGeometry(1.3, 1);
    const innerMat = new THREE.MeshPhongMaterial({
      color: 0x00d084,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.7,
      shininess: 120,
      transparent: true,
      opacity: 0.85,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    group.add(innerMesh);

    // Outer Orbiting Rings (Tech Halo)
    const ringGeo1 = new THREE.TorusGeometry(3.1, 0.04, 16, 100);
    const ringMat1 = new THREE.MeshBasicMaterial({
      color: 0x27c40b,
      wireframe: false,
    });
    const ringMesh1 = new THREE.Mesh(ringGeo1, ringMat1);
    ringMesh1.rotation.x = Math.PI / 3;
    group.add(ringMesh1);

    const ringGeo2 = new THREE.TorusGeometry(3.4, 0.03, 16, 100);
    const ringMat2 = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      wireframe: false,
    });
    const ringMesh2 = new THREE.Mesh(ringGeo2, ringMat2);
    ringMesh2.rotation.y = Math.PI / 4;
    group.add(ringMesh2);

    // Tech Particle Cloud
    const particleCount = 220;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      particlePositions[i] = (Math.random() - 0.5) * 16;
      particlePositions[i + 1] = (Math.random() - 0.5) * 16;
      particlePositions[i + 2] = (Math.random() - 0.5) * 16;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x27c40b,
      size: 0.05,
      transparent: true,
      opacity: 0.8,
    });
    const particleSystem = new THREE.Points(particleGeo, particleMat);
    scene.add(particleSystem);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x27c40b, 2.5, 20);
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
      coreMesh.rotation.y += 0.006;
      coreMesh.rotation.x += 0.003;
      innerMesh.rotation.y -= 0.009;
      ringMesh1.rotation.z += 0.005;
      ringMesh2.rotation.x += 0.004;
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
      ringGeo1.dispose();
      ringMat1.dispose();
      ringGeo2.dispose();
      ringMat2.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    };
  }, []);

  return (
    <div className="relative w-full h-[360px] sm:h-[450px] lg:h-[500px] flex items-center justify-center overflow-hidden">
      {/* Background glow behind 3D Canvas */}
      <div className="absolute w-72 h-72 sm:w-96 sm:h-96 bg-[#27c40b]/20 rounded-full blur-[110px] pointer-events-none -z-10 animate-pulse" />
      <div className="absolute w-60 h-60 sm:w-80 sm:h-80 bg-cyan-500/15 rounded-full blur-[90px] pointer-events-none -z-10 translate-x-20 translate-y-10" />
      
      {/* Three.js Canvas Container */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
    </div>
  );
}
