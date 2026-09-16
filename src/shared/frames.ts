/**
 * Which frame the panel is working in.
 *
 * The app under test often is not the tab: it runs in an iframe, and everything
 * the panel does — filling a form, reading one, watching traffic — has to name
 * that frame rather than shout at all of them. Chrome hands the frame's id to
 * the worker for free on `port.sender.frameId`, and it belongs to the *frame*,
 * not the document, so a choice made once survives the frame navigating.
 */

/** The top frame is always 0; children are positive. */
export const TOP_FRAME_ID = 0;

/** What the panel needs to show a frame in a list and let a person recognise it. */
export interface FrameInfo {
  frameId: number;
  url: string;
  /**
   * How many frames up to the top; the top frame is 0. Reported by the frame
   * itself — `sender` carries no parent, and walking `window.parent` is one of
   * the few things a cross-origin frame may still do.
   */
  depth: number;
  /** Fields a person could fill here — the strongest hint at which frame is the app. */
  inputs: number;
  /** First heading or the document title, for when several frames share a host. */
  heading?: string;
}

/** What a frame reports about itself; the worker adds the id it already knows. */
export type FrameDescriptor = Pick<FrameInfo, 'url' | 'depth' | 'inputs' | 'heading'>;

/**
 * The frame a person most likely means, when they have not said.
 *
 * The app is the frame with fields in it; among equals the shallowest wins,
 * because a simulator wraps the app rather than the other way round. With
 * nothing to go on this returns the top frame, which is today's behaviour.
 */
export function guessWorkingFrame(frames: FrameInfo[]): number {
  const withFields = frames.filter((frame) => frame.inputs > 0);
  if (withFields.length === 0) return TOP_FRAME_ID;
  return withFields.reduce((best, frame) => {
    if (frame.inputs !== best.inputs) return frame.inputs > best.inputs ? frame : best;
    return frame.depth < best.depth ? frame : best;
  }).frameId;
}

/** A short, human-readable name for a frame row. */
export function describeFrame(frame: FrameInfo): string {
  if (frame.heading) return frame.heading;
  try {
    const { host, pathname } = new URL(frame.url);
    return `${host}${pathname}`;
  } catch {
    return frame.url || 'about:blank';
  }
}
