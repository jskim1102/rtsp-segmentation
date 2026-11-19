import { useEffect, useRef, useState } from "react";
import { resolveClassColor } from "../utils/colors";
import type { ModelSettings } from "./ModelSettingsModal";

/**
 * WHEP `<video>` 위에 절대 위치 `<canvas>` 로 instance mask 오버레이. ← 하이브리드 SEAM
 *
 * 영상(WHEP)과 추론 프레임(백엔드 별도 캡처)이 서로 다른 장이므로, 폴리곤과 bbox 좌표를
 * `videoNatural / detFrame` 비율로 보정한다. 새 결과가 도착하면 한 번 그리고 다음 결과까지
 * canvas 픽셀을 유지한다. 빈 결과는 즉시 지운다.
 */

const MASK_FILL_ALPHA = 0.35;

export interface SegObject {
  class_id: number;
  name: string;
  conf: number;
  xyxy: [number, number, number, number];
  mask: [number, number][];
  model: string;
}

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  detections: SegObject[];
  frameW: number;
  frameH: number;
  settings?: Record<string, ModelSettings>;
}

function filterVisible(
  detections: SegObject[],
  settings?: Record<string, ModelSettings>,
): SegObject[] {
  return detections.filter((seg) => {
    const modelSettings = settings?.[seg.model];
    const enabledClasses = modelSettings?.classes;
    if (
      enabledClasses !== undefined &&
      enabledClasses !== null &&
      !enabledClasses.includes(seg.class_id)
    ) {
      return false;
    }
    if (modelSettings?.conf !== undefined && seg.conf < modelSettings.conf) {
      return false;
    }
    return true;
  });
}

function traceMask(
  ctx: CanvasRenderingContext2D,
  mask: [number, number][],
  sx: number,
  sy: number,
): boolean {
  if (mask.length < 3) return false;
  ctx.beginPath();
  ctx.moveTo(mask[0][0] * sx, mask[0][1] * sy);
  for (let index = 1; index < mask.length; index += 1) {
    ctx.lineTo(mask[index][0] * sx, mask[index][1] * sy);
  }
  ctx.closePath();
  return true;
}

function SegmentationOverlay({
  videoRef,
  detections,
  frameW,
  frameH,
  settings,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // WHEP srcObject의 intrinsic 크기를 loadedmetadata + resize 이벤트로 추적한다.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => {
      if (video.videoWidth && video.videoHeight) {
        setSize((previous) => {
          if (previous?.w === video.videoWidth && previous?.h === video.videoHeight) {
            return previous;
          }
          return { w: video.videoWidth, h: video.videoHeight };
        });
      }
    };
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    update();
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
    };
  }, [videoRef]);

  // 최신 결과를 한 번 그린다. 시간축 좌표 보간 없이 다음 WS 결과까지 그대로 유지한다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (detections.length === 0) return;

    const sx = frameW > 0 ? size.w / frameW : 1;
    const sy = frameH > 0 ? size.h / frameH : 1;
    const visible = filterVisible(detections, settings).filter(
      (seg) => seg.mask.length >= 3,
    );
    if (visible.length === 0) return;

    const scale = Math.max(1, Math.min(size.w, size.h) / 600);
    const lineWidth = Math.max(1.5, 2 * scale);
    const fontPx = Math.max(11, Math.round(13 * scale));
    ctx.font = `${fontPx}px sans-serif`;
    ctx.textBaseline = "top";

    const distinctModels = new Set(visible.map((seg) => seg.model).filter(Boolean));
    const showModelPrefix = distinctModels.size >= 2;

    // 계약 순서 1: 모든 마스크를 반투명으로 먼저 채운다.
    ctx.globalAlpha = MASK_FILL_ALPHA;
    for (const seg of visible) {
      if (!traceMask(ctx, seg.mask, sx, sy)) continue;
      ctx.fillStyle = resolveClassColor(
        seg.class_id,
        settings?.[seg.model]?.colors,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 계약 순서 2: 같은 색의 불투명 외곽선을 그린다.
    ctx.lineWidth = lineWidth;
    for (const seg of visible) {
      if (!traceMask(ctx, seg.mask, sx, sy)) continue;
      ctx.strokeStyle = resolveClassColor(
        seg.class_id,
        settings?.[seg.model]?.colors,
      );
      ctx.stroke();
    }

    // 계약 순서 3: 다른 객체의 채움에 가리지 않도록 라벨을 마지막에 그린다.
    for (const seg of visible) {
      const [rawX1, rawY1] = seg.xyxy;
      const x1 = rawX1 * sx;
      const y1 = rawY1 * sy;
      const color = resolveClassColor(
        seg.class_id,
        settings?.[seg.model]?.colors,
      );
      const shortModel =
        showModelPrefix && seg.model
          ? seg.model.endsWith(".pt")
            ? seg.model.slice(0, -3)
            : seg.model
          : "";
      const label = shortModel
        ? `[${shortModel}] ${seg.name} ${seg.conf.toFixed(2)}`
        : `${seg.name} ${seg.conf.toFixed(2)}`;
      const padX = 4 * scale;
      const padY = 2 * scale;
      const textWidth = ctx.measureText(label).width;
      const labelHeight = fontPx + padY * 2;
      const labelY = Math.max(0, y1 - labelHeight);

      ctx.fillStyle = color;
      ctx.fillRect(x1, labelY, textWidth + padX * 2, labelHeight);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x1 + padX, labelY + padY);
    }
  }, [detections, frameH, frameW, settings, size]);

  if (!size) return null;

  return (
    <canvas
      ref={canvasRef}
      width={size.w}
      height={size.h}
      style={canvasStyle}
    />
  );
}

const canvasStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "contain",
  pointerEvents: "none",
};

export default SegmentationOverlay;
