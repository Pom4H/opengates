import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT, SANS, INTRO_FRAMES, STAGE_FRAMES, STAGES } from "./theme.ts";
import { STEPS } from "./data.ts";

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const Stepper: React.FC<{ active: number; progress: number }> = ({
  active,
  progress,
}) => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 0,
        width: "100%",
      }}
    >
      {STEPS.map((s, i) => {
        const done = i < active;
        const isActive = i === active;
        const on = done || isActive;
        return (
          <React.Fragment key={s.key}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                width: 150,
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 26,
                  fontFamily: FONT,
                  color: on ? "#06121f" : COLORS.textDim,
                  background: on ? s.color : COLORS.bgCard,
                  border: `1.5px solid ${on ? s.color : COLORS.border}`,
                  boxShadow: isActive ? `0 0 32px ${s.color}66` : "none",
                  transform: `scale(${isActive ? 1.12 : 1})`,
                  transition: "none",
                }}
              >
                {s.glyph}
              </div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 13,
                  letterSpacing: 1.5,
                  color: on ? s.color : COLORS.textFaint,
                  fontWeight: 600,
                }}
              >
                {s.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  height: 3,
                  marginTop: -26,
                  background: COLORS.track,
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${
                      i < active ? 100 : i === active ? progress * 100 : 0
                    }%`,
                    background: `linear-gradient(90deg, ${STEPS[i].color}, ${
                      STEPS[i + 1].color
                    })`,
                  }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const DetailCard: React.FC<{ stepIndex: number; local: number; fps: number }> = ({
  stepIndex,
  local,
  fps,
}) => {
  const s = STEPS[stepIndex];
  const enter = spring({ frame: local, fps, config: { damping: 18, mass: 0.6 } });
  return (
    <div
      style={{
        width: 940,
        background: COLORS.bgCard,
        border: `1.5px solid ${COLORS.borderActive}`,
        borderRadius: 20,
        padding: "34px 44px",
        boxShadow: `0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px ${s.color}22`,
        opacity: enter,
        transform: `translateY(${(1 - enter) * 26}px)`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          marginBottom: 22,
        }}
      >
        <span
          style={{
            fontFamily: FONT,
            fontSize: 14,
            letterSpacing: 2,
            color: s.color,
            fontWeight: 700,
          }}
        >
          {s.label}
        </span>
        <span style={{ color: COLORS.border }}>—</span>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 26,
            color: COLORS.text,
            fontWeight: 600,
          }}
        >
          {s.title}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {s.lines.map((line, i) => {
          const appear = interpolate(
            local,
            [10 + i * 9, 22 + i * 9],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          );
          return (
            <div
              key={i}
              style={{
                fontFamily: FONT,
                fontSize: 27,
                color: i === s.lines.length - 1 ? s.color : COLORS.text,
                opacity: appear,
                transform: `translateX(${(1 - appear) * 16}px)`,
                whiteSpace: "pre",
              }}
            >
              {line}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const Flow: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title intro fade.
  const introA = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Which stage are we in?
  const t = Math.max(0, frame - INTRO_FRAMES);
  const rawStage = Math.floor(t / STAGE_FRAMES);
  const stage = Math.min(rawStage, STAGES - 1);
  const local = t - stage * STAGE_FRAMES;
  const progress = easeOut(Math.min(1, local / (STAGE_FRAMES * 0.7)));

  const afterAll = frame - (INTRO_FRAMES + STAGES * STAGE_FRAMES);
  const outro = afterAll > 0;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1200px 700px at 50% -10%, #0d1a2b 0%, ${COLORS.bg} 60%)`,
        fontFamily: SANS,
        padding: "56px 70px",
        justifyContent: "space-between",
      }}
    >
      {/* Header */}
      <div style={{ opacity: introA, textAlign: "center" }}>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 17,
            letterSpacing: 8,
            color: COLORS.accent,
            fontWeight: 700,
          }}
        >
          OPEN&nbsp;GATES
        </div>
        <div
          style={{
            fontSize: 34,
            color: COLORS.text,
            fontWeight: 700,
            marginTop: 8,
          }}
        >
          A claim becomes an{" "}
          <span style={{ color: COLORS.accent }}>accepted fact.</span>
        </div>
        <div style={{ fontSize: 18, color: COLORS.textDim, marginTop: 6 }}>
          Not task management. Fact acceptance.
        </div>
      </div>

      {/* Stepper */}
      <div style={{ opacity: introA }}>
        <Stepper active={outro ? STAGES : stage} progress={outro ? 1 : progress} />
      </div>

      {/* Detail card or outro */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 300,
        }}
      >
        {!outro ? (
          <DetailCard stepIndex={stage} local={local} fps={fps} />
        ) : (
          <Outro frame={afterAll} fps={fps} />
        )}
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          fontFamily: FONT,
          fontSize: 15,
          color: COLORS.textFaint,
          opacity: introA,
        }}
      >
        construction · work-volume acceptance — one of many gates
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ frame: number; fps: number }> = ({ frame, fps }) => {
  const e = spring({ frame, fps, config: { damping: 16 } });
  const pills = [
    { t: "💶 money", c: COLORS.money },
    { t: "🔓 right to proceed", c: COLORS.proceed },
    { t: "⚠️ owned risk", c: COLORS.risk },
    { t: "🏷️ dataset label", c: COLORS.label },
  ];
  return (
    <div
      style={{
        textAlign: "center",
        opacity: e,
        transform: `scale(${0.92 + e * 0.08})`,
      }}
    >
      <div style={{ fontSize: 40, color: COLORS.text, fontWeight: 700 }}>
        <span style={{ color: COLORS.accent }}>accepted</span> — and the
        consequences fire
      </div>
      <div
        style={{
          display: "flex",
          gap: 16,
          justifyContent: "center",
          marginTop: 28,
        }}
      >
        {pills.map((p, i) => {
          const pe = interpolate(frame, [8 + i * 6, 20 + i * 6], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={i}
              style={{
                fontFamily: FONT,
                fontSize: 22,
                color: p.c,
                border: `1.5px solid ${p.c}55`,
                background: `${p.c}14`,
                borderRadius: 999,
                padding: "12px 22px",
                opacity: pe,
                transform: `translateY(${(1 - pe) * 12}px)`,
              }}
            >
              {p.t}
            </div>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: FONT,
          fontSize: 18,
          color: COLORS.textDim,
          marginTop: 30,
        }}
      >
        github.com/Pom4H/opengates
      </div>
    </div>
  );
};
