import { useEffect, useRef, useState } from "react";
import SegmentationOverlay, {
  type SegObject,
} from "../components/SegmentationOverlay";
import type { ModelSettings } from "../components/ModelSettingsModal";
import { defaultClassColor } from "../utils/colors";

const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;
const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 360;
const MODELS = ["yolo26n-seg.pt", "yolo26s-seg.pt"] as const;

function ellipse(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  points = 24,
): [number, number][] {
  return Array.from({ length: points }, (_, index) => {
    const angle = (index / points) * Math.PI * 2;
    return [
      Math.round(centerX + Math.cos(angle) * radiusX),
      Math.round(centerY + Math.sin(angle) * radiusY),
    ];
  });
}

const SEGMENTS: SegObject[] = [
  {
    class_id: 0,
    name: "person",
    conf: 0.94,
    xyxy: [55, 30, 235, 335],
    mask: ellipse(145, 182, 82, 145),
    model: MODELS[0],
  },
  {
    class_id: 2,
    name: "car",
    conf: 0.88,
    xyxy: [245, 155, 455, 315],
    mask: ellipse(350, 235, 100, 72),
    model: MODELS[1],
  },
  {
    class_id: 5,
    name: "bus",
    conf: 0.81,
    xyxy: [430, 65, 625, 290],
    mask: ellipse(528, 180, 90, 108),
    model: MODELS[0],
  },
];

const CLASS_OPTIONS = SEGMENTS.map(({ class_id, name }) => ({
  id: class_id,
  name,
}));
const ALL_CLASS_IDS = CLASS_OPTIONS.map(({ id }) => id);

function drawTestPattern(ctx: CanvasRenderingContext2D) {
  const gradient = ctx.createLinearGradient(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
  gradient.addColorStop(0, "#111827");
  gradient.addColorStop(1, "#334155");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= VIDEO_WIDTH; x += 160) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, VIDEO_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= VIDEO_HEIGHT; y += 90) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VIDEO_WIDTH, y);
    ctx.stroke();
  }

  // 검출 frame 좌표를 정확히 2배 한 실루엣. overlay가 맞으면 외곽선이 이 형상과 포개진다.
  for (const segment of SEGMENTS) {
    ctx.beginPath();
    ctx.moveTo(segment.mask[0][0] * 2, segment.mask[0][1] * 2);
    for (let index = 1; index < segment.mask.length; index += 1) {
      ctx.lineTo(segment.mask[index][0] * 2, segment.mask[index][1] * 2);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.72)";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "24px sans-serif";
  ctx.fillText("video 1280×720 · detection frame 640×360 · expected scale 2×", 24, 40);
}

export default function MockSegPreview() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [modelSettings, setModelSettings] = useState<
    Record<string, ModelSettings>
  >(() => Object.fromEntries(MODELS.map((model) => [model, { classes: null }])));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const source = document.createElement("canvas");
    source.width = VIDEO_WIDTH;
    source.height = VIDEO_HEIGHT;
    const ctx = source.getContext("2d");
    if (!ctx) {
      setPreviewError("테스트 canvas를 만들 수 없습니다.");
      return;
    }
    drawTestPattern(ctx);

    const stream = source.captureStream(10);
    video.srcObject = stream;
    void video.play().catch(() => {
      setPreviewError("mock video 자동 재생에 실패했습니다.");
    });

    return () => {
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, []);

  const enabledClasses = modelSettings[MODELS[0]]?.classes;

  const toggleClass = (classId: number) => {
    setModelSettings((previous) => {
      const current = previous[MODELS[0]]?.classes ?? ALL_CLASS_IDS;
      const next = current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId].sort((a, b) => a - b);
      const normalized = next.length === ALL_CLASS_IDS.length ? null : next;
      return Object.fromEntries(
        MODELS.map((model) => [
          model,
          { ...previous[model], classes: normalized },
        ]),
      );
    });
  };

  return (
    <main className="app">
      <header className="page-head">
        <div>
          <h1>Segmentation Overlay Mock</h1>
          <p className="subtitle">
            백엔드 없이 실제 overlay 컴포넌트와 2× SEAM 스케일을 검수합니다.
          </p>
        </div>
      </header>

      <section style={styles.controls} aria-label="표시 클래스">
        {CLASS_OPTIONS.map(({ id, name }) => {
          const checked = enabledClasses === null || enabledClasses === undefined
            ? true
            : enabledClasses.includes(id);
          return (
            <label key={id} style={styles.classToggle}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleClass(id)}
                style={styles.checkbox}
              />
              <span
                aria-hidden="true"
                style={{ ...styles.swatch, backgroundColor: defaultClassColor(id) }}
              />
              {name} #{id}
            </label>
          );
        })}
      </section>

      {previewError && <p style={styles.error}>{previewError}</p>}
      <div style={styles.viewport}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={styles.video}
        />
        <SegmentationOverlay
          videoRef={videoRef}
          detections={SEGMENTS}
          frameW={FRAME_WIDTH}
          frameH={FRAME_HEIGHT}
          settings={modelSettings}
        />
      </div>
      <p style={styles.hint}>
        흰 실루엣과 마스크 외곽선이 맞물리면 640×360 → 1280×720 좌표 배율이 정확합니다.
      </p>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  controls: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    marginBottom: "12px",
    padding: "12px",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
  },
  classToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    margin: 0,
    cursor: "pointer",
  },
  checkbox: { width: "16px", height: "16px" },
  swatch: { width: "14px", height: "14px", borderRadius: "3px" },
  viewport: {
    position: "relative",
    width: "100%",
    aspectRatio: "16 / 9",
    overflow: "hidden",
    background: "#111827",
  },
  video: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  hint: { margin: "8px 0 0", color: "#6b7280" },
  error: { color: "#dc2626" },
};
