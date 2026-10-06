import { useState } from 'react';
import { describeFrame, TOP_FRAME_ID, type FrameInfo } from '../../shared/frames';
import { IconChevron } from './icons';

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
  /*
   * A frame list is a decision, not a readout: it is long, it is read once, and
   * every row of it is height the fields below do not get. So the card opens
   * only while the decision is open — nothing chosen yet — and folds back to
   * one line naming the answer as soon as one is made.
   */
  const [open, setOpen] = useState(workingFrameId === undefined);

  // One frame is the tab itself: there is nothing to choose between.
  if (frames.length <= 1) return null;

  const chosen = frames.find((frame) => frame.frameId === workingFrameId);
  /*
   * A chosen frame missing from the list is the state in which every fill, read
   * and screen check fails — the frame was removed, navigated away or parked in
   * the back/forward cache. The one line the card folds to has to say that,
   * because the panel looks just as ready as it did a moment before.
   */
  const gone = workingFrameId !== undefined && !chosen;
  const choose = (frameId?: number) => {
    onSelect(frameId);
    setOpen(false);
  };

  return (
    <div className="panel-card mb-2 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title="Which frame Fill, Read and Pick act in"
        >
          <IconChevron
            className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="shrink-0 text-[12px] font-semibold text-ink">Working frame</span>
          {!open && (
            <>
              <span
                className={`min-w-0 flex-1 truncate text-[11px] ${gone ? 'text-warn' : 'text-mute'}`}
              >
                {chosen
                  ? describeFrame(chosen)
                  : gone
                    ? 'gone — pick the frame again'
                    : 'Every frame'}
              </span>
              {chosen?.inputs !== undefined && chosen.inputs > 0 && (
                <span className="chip chip-ok shrink-0" title="Fields that can be filled here">
                  {chosen.inputs}
                </span>
              )}
            </>
          )}
        </button>
        <button onClick={onRefresh} className="btn-link shrink-0" title="Re-read the frames">
          Refresh
        </button>
        <button onClick={onPick} disabled={busy} className="btn btn-ghost btn-sm shrink-0">
          Pick
        </button>
      </div>

      {open && (
        <>
          <p className="m-0 mt-2 mb-2 text-[11px] leading-relaxed text-faint">
            Fill, Read and Pick act here. Choose the frame the app is in — or press Pick and click
            something inside it.
          </p>

          <div className="space-y-1">
            <FrameRow
              label="Every frame"
              detail="the old behaviour: whichever frame answers"
              selected={workingFrameId === undefined}
              onSelect={() => choose(undefined)}
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
                onSelect={() => choose(frame.frameId)}
              />
            ))}
          </div>
        </>
      )}
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
