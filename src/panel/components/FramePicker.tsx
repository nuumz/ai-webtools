import { describeFrame, TOP_FRAME_ID, type FrameInfo } from '../../shared/frames';

interface Props {
  frames: FrameInfo[];
  workingFrameId?: number;
  busy?: boolean;
  onSelect: (frameId?: number) => void;
  onRefresh: () => void;
  onPick: () => void;
}

/**
 * Which frame the panel acts in.
 *
 * An app that runs inside a simulator, a shell or a portal is not the tab, and
 * filling "the page" then writes into whichever frame answers first. Naming the
 * frame once fixes fill, read and pick together — and the id belongs to the
 * frame rather than the document, so it survives that frame navigating.
 */
export default function FramePicker({
  frames,
  workingFrameId,
  busy,
  onSelect,
  onRefresh,
  onPick,
}: Props) {
  // One frame is the tab itself: there is nothing to choose between.
  if (frames.length <= 1) return null;

  return (
    <div className="panel-card mb-3 p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
        <h2 className="m-0 text-[13px] font-semibold">Working frame</h2>
        <div className="flex items-center gap-1.5">
          <button onClick={onRefresh} className="btn-link" title="Re-read the frames">
            Refresh
          </button>
          <button onClick={onPick} disabled={busy} className="btn btn-ghost btn-sm">
            Pick
          </button>
        </div>
      </div>

      <p className="m-0 mb-2 text-[11px] leading-relaxed text-faint">
        Fill, Read and Pick act here. Choose the frame the app is in — or press Pick and click
        something inside it.
      </p>

      <div className="space-y-1">
        <FrameRow
          label="Every frame"
          detail="the old behaviour: whichever frame answers"
          selected={workingFrameId === undefined}
          onSelect={() => onSelect(undefined)}
        />
        {frames.map((frame) => (
          <FrameRow
            key={frame.frameId}
            label={describeFrame(frame)}
            detail={frame.url}
            depth={frame.depth}
            inputs={frame.inputs}
            top={frame.frameId === TOP_FRAME_ID}
            selected={workingFrameId === frame.frameId}
            onSelect={() => onSelect(frame.frameId)}
          />
        ))}
      </div>
    </div>
  );
}

function FrameRow({
  label,
  detail,
  depth = 0,
  inputs,
  top,
  selected,
  onSelect,
}: {
  label: string;
  detail: string;
  depth?: number;
  inputs?: number;
  top?: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      title={detail}
      aria-pressed={selected}
      className={`flex w-full items-center gap-2 rounded-[var(--radius-md)] border px-2 py-1.5 text-left transition-colors ${
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-inset hover:border-line-strong'
      }`}
      style={depth > 0 ? { paddingLeft: `${0.5 + depth * 0.75}rem` } : undefined}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-ink">{label}</span>
        <span className="block truncate font-mono text-[10.5px] text-faint">{detail}</span>
      </span>
      {top && <span className="chip shrink-0">top</span>}
      {inputs !== undefined && inputs > 0 && (
        <span className="chip chip-ok shrink-0" title="Fields that can be filled here">
          {inputs}
        </span>
      )}
    </button>
  );
}
