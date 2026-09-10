import { useState } from 'react';
import { IconChevron } from './icons';
import { DEFAULT_STRICT_PATTERN, type MatchOn, type StoryMeta } from '../../shared/story';

interface Props {
  stories: StoryMeta[];
  onUpdate: (story: StoryMeta) => void;
  onDelete: (storyId: string) => void;
}

export default function StoriesCard({ stories, onUpdate, onDelete }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (stories.length === 0) {
    return (
      <p className="empty">
        No stories yet.
        <br />
        Record traffic, pick the rows you want, then save them here. Replaying a story serves those
        responses without touching the backend.
      </p>
    );
  }

  return (
    <div className="card overflow-hidden">
      {stories.map((story, index) => {
        const open = openId === story.id;
        return (
          <div key={story.id} className={index > 0 ? 'border-t border-line' : undefined}>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <input
                type="checkbox"
                checked={story.isActive}
                onChange={(e) => onUpdate({ ...story, isActive: e.target.checked })}
                title={story.isActive ? 'Playing — click to stop' : 'Stopped — click to play'}
              />
              <input
                className="field-bare min-w-0 flex-1"
                value={story.name}
                onChange={(e) => onUpdate({ ...story, name: e.target.value })}
                aria-label="Story name"
              />
              {story.isActive && <span className="chip chip-ok">playing</span>}
              {story.strict && <span className="chip chip-warn">strict</span>}
              <span className="log-cell text-faint">{story.entryCount}</span>
              <button
                onClick={() => setOpenId(open ? null : story.id)}
                className="btn btn-sm btn-icon btn-ghost"
                aria-expanded={open}
                title={open ? 'Hide options' : 'Show options'}
              >
                <IconChevron className={`transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
            </div>

            {open && (
              <div className="space-y-2.5 border-t border-line bg-inset p-2">
                <label className="flex items-center gap-2 text-[11px] text-mute">
                  <span className="w-16 shrink-0">Match on</span>
                  <select
                    className="field field-sm !w-auto"
                    value={story.matchOn}
                    onChange={(e) => onUpdate({ ...story, matchOn: e.target.value as MatchOn })}
                  >
                    <option value="path+query">path + query string</option>
                    <option value="path">path only</option>
                  </select>
                  <span className="text-faint">newly saved entries only</span>
                </label>

                <label className="flex items-center gap-2 text-[11px] text-mute">
                  <input
                    type="checkbox"
                    checked={story.replayTiming}
                    onChange={(e) => onUpdate({ ...story, replayTiming: e.target.checked })}
                  />
                  Replay the latency each response was recorded with
                </label>

                <label className="flex items-center gap-2 text-[11px] text-mute">
                  <input
                    type="checkbox"
                    checked={story.strict}
                    onChange={(e) => onUpdate({ ...story, strict: e.target.checked })}
                  />
                  Strict — answer 501 for requests this story does not cover
                </label>

                {story.strict && (
                  <label className="flex items-center gap-2 text-[11px] text-mute">
                    <span className="w-16 shrink-0">Scope</span>
                    <input
                      className="field field-mono field-sm flex-1"
                      value={story.strictPattern}
                      placeholder={DEFAULT_STRICT_PATTERN}
                      onChange={(e) => onUpdate({ ...story, strictPattern: e.target.value })}
                    />
                  </label>
                )}

                <div className="flex justify-end border-t border-line pt-2">
                  <button onClick={() => onDelete(story.id)} className="btn-link btn-danger">
                    Delete story
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
