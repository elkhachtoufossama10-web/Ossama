import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface ChartProps {
  data: uPlot.AlignedData;
  series: uPlot.Series[];
  height?: number;
  axes?: uPlot.Axis[];
  scales?: uPlot.Scales;
  marker?: number | null; // x value to mark (e.g. selected time)
  bands?: uPlot.Band[];
  title: string; // accessible description
  xTime?: boolean;
  tzOffsetMin?: number;
}

const axisStyle = { stroke: '#9fb3c8', grid: { stroke: 'rgba(160,190,220,0.12)', width: 1 }, ticks: { stroke: 'rgba(160,190,220,0.25)', width: 1 }, font: '11px system-ui, sans-serif' };

export default function Chart({ data, series, height = 180, axes, scales, marker, bands, title, xTime = true, tzOffsetMin = 0 }: ChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const markerRef = useRef(marker);
  markerRef.current = marker;
  useEffect(() => {
    if (!el.current) return;
    const width = el.current.clientWidth || 320;
    const opts: uPlot.Options = {
      width, height, series: [{}, ...series], bands,
      scales: { x: { time: xTime }, ...scales },
      axes: (axes ?? [{}, {}]).map((a) => ({ ...axisStyle, ...a })),
      legend: { show: true, live: true },
      cursor: { drag: { x: false, y: false } },
      tzDate: xTime ? (ts) => uPlot.tzDate(new Date((ts + tzOffsetMin * 60) * 1000), 'Etc/UTC') : undefined,
      hooks: {
        draw: [(u) => {
          const m = markerRef.current;
          if (m === null || m === undefined) return;
          const x = u.valToPos(m, 'x', true);
          if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
          const ctx = u.ctx;
          ctx.save();
          ctx.strokeStyle = '#ff5f87';
          ctx.lineWidth = 2 * devicePixelRatio;
          ctx.setLineDash([4 * devicePixelRatio, 3 * devicePixelRatio]);
          ctx.beginPath();
          ctx.moveTo(x, u.bbox.top);
          ctx.lineTo(x, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.restore();
        }],
      },
    };
    plot.current = new uPlot(opts, data, el.current);
    const ro = new ResizeObserver(() => {
      if (el.current && plot.current) plot.current.setSize({ width: el.current.clientWidth, height });
    });
    ro.observe(el.current);
    return () => { ro.disconnect(); plot.current?.destroy(); plot.current = null; };
    // re-create when the structure changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.length, height, JSON.stringify(series.map((s) => s.label)), tzOffsetMin]);
  useEffect(() => { plot.current?.setData(data); }, [data]);
  useEffect(() => { plot.current?.redraw(false); }, [marker]);
  return <div className="chart" dir="ltr" ref={el} role="img" aria-label={title} />;
}
