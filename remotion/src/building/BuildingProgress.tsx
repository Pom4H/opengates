import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ThreeCanvas } from "@remotion/three";
import { BuildingScene } from "./Scene.tsx";
import { MODEL, systemProgress } from "./model.ts";
import { COLORS, FONT, SANS } from "../theme.ts";

export const BUILDING_FPS = 30;
export const BUILDING_FRAMES = 420;

const RISE_START = 24;
const RISE_END = 384; // wave sweeps 0 → maxArrival across this span

const SystemsHUD: React.FC<{ p: number }> = ({ p }) => {
  const frac = systemProgress(p);
  return (
    <div
      style={{
        position: "absolute",
        left: 56,
        bottom: 46,
        display: "flex",
        flexDirection: "column",
        gap: 11,
        width: 360,
      }}
    >
      <div style={{ fontFamily: FONT, fontSize: 13, letterSpacing: 2, color: COLORS.textDim }}>
        PARALLEL SYSTEMS — each waits on the one above
      </div>
      {MODEL.systems.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              width: 15,
              height: 15,
              borderRadius: 4,
              background: s.color,
              boxShadow: `0 0 12px ${s.color}99`,
            }}
          />
          <span style={{ fontFamily: FONT, fontSize: 17, color: COLORS.text, width: 150 }}>
            {i + 1}. {s.name}
          </span>
          <div style={{ flex: 1, height: 6, background: COLORS.track, borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${frac[i] * 100}%`, height: "100%", background: s.color }} />
          </div>
        </div>
      ))}
    </div>
  );
};

export const BuildingProgress: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const p = interpolate(frame, [RISE_START, RISE_END], [0, MODEL.build.maxArrival], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Elevated 3/4 orbit so the diagonal sweep across the X–Z plan reads in 3D.
  const angle = interpolate(frame, [0, BUILDING_FRAMES], [-0.55, 0.75]);
  const radius = 58;
  const camX = Math.sin(angle) * radius;
  const camZ = Math.cos(angle) * radius;
  const camY = interpolate(frame, [0, BUILDING_FRAMES], [30, 38]);

  const intro = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: `radial-gradient(1200px 800px at 50% 0%, #101c2e 0%, ${COLORS.bg} 65%)` }}>
      <ThreeCanvas
        width={width}
        height={height}
        camera={{ position: [camX, camY, camZ], fov: 42 }}
        style={{ position: "absolute", inset: 0 }}
        gl={{ antialias: true }}
        onCreated={({ camera }) => {
          // @ts-expect-error three camera lookAt is available at runtime
          camera.lookAt(0, 10, 0);
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight position={[34, 54, 28]} intensity={1.5} castShadow />
        <directionalLight position={[-28, 22, -22]} intensity={0.4} color="#88aaff" />
        <BuildingScene p={p} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.71, 0]}>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color="#0a121d" roughness={1} />
        </mesh>
      </ThreeCanvas>

      <div style={{ position: "absolute", top: 44, left: 56, opacity: intro }}>
        <div style={{ fontFamily: FONT, fontSize: 15, letterSpacing: 6, color: COLORS.accent, fontWeight: 700 }}>
          OPEN&nbsp;GATES · SPATIAL ZONES
        </div>
        <div style={{ fontFamily: SANS, fontSize: 30, color: COLORS.text, fontWeight: 700, marginTop: 6 }}>
          Systems build <span style={{ color: COLORS.accent }}>diagonally</span>, block by block
        </div>
        <div style={{ fontFamily: SANS, fontSize: 17, color: COLORS.textDim, marginTop: 4 }}>
          {MODEL.grid.nx}×{MODEL.grid.nz} blocks · {MODEL.grid.floors} floors · structure → façade → MEP → fit-out
        </div>
      </div>

      <SystemsHUD p={p} />
    </AbsoluteFill>
  );
};
