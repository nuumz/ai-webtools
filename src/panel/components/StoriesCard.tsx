import { useState } from 'react';
import { DEFAULT_STRICT_PATTERN, type MatchOn, type StoryMeta } from '../../shared/story';

interface Props {
  stories: StoryMeta[];
  onUpdate: (story: StoryMeta) => void;
  onDelete: (storyId: string) => void;
}

export default function StoriesCard({ stories, onUpdate, onDelete }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const activeCount = stories.filter((story) => story.isActive).length;

  return (
    <div className="panel-card mb-3 p-3.5">
      <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
        <h2 className="m-0 text-[13px] font-semibold">Stories</h2>
        <span className="text-[11px] text-faint">
          {stories.length === 0 ? 'none yet' : `${activeCount} of ${stories.length} playing`}
        </span>
      </div>

      {stories.length === 0 ? (
        <p className="panel-empty !py-3">
          Record some traffic, Select the rows you want, then Save to story. Replaying a story
          serves those responses without touching the backend.
        </p>
      ) : (
        <div className="space-y-2">
          {stories.map((story) => (
            <div
              key={story.id}
              className={`overflow-hidden rounded-[var(--radius-md)] border ${
                story.isActive ? 'border-ok/40 bg-ok-soft' : 'border-line'
              }`}
            >
              <div className="flex items-center gap-2 p-2">
                <input
                  type="checkbox"
                  checked={story.isActive}
                  onChange={(e) => onUpdate({ ...story, isActive: e.target.checked })}
                  title="Replay this story"
                />
                <input
                  className="min-w-0 flex-1 rounded-[var(--radius-sm)] bg-transparent px-1 py-0.5 text-[12px] font-semibold text-ink focus:bg-inset focus:outline-none focus:ring-1 focus:ring-accent"
                  value={story.name}
                  onChange={(e) => onUpdate({ ...story, name: e.target.value })}
                />
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                  {story.entryCount} entries
                </span>
                <button
                  onClick={() => setExpandedId(expandedId === story.id ? null : story.id)}
                  className="btn-link"
                >
                  {expandedId === story.id ? 'Hide' : 'Options'}
                </button>
              </div>

              {expandedId === story.id && (
                <div className="space-y-2 border-t border-line bg-surface p-2.5">
                  <label className="flex items-center gap-2 text-[11px] text-mute">
                    <span className="w-20 shrink-0">Match on</span>
                    <select
                      className="field field-sm !w-auto"
                      value={story.matchOn}
                      onChange={(e) => onUpdate({ ...story, matchOn: e.target.value as MatchOn })}
                    >
                      <option value="path+query">path + query string</option>
                      <option value="path">path only</option>
                    </select>
                    <span className="text-faint">applies to newly saved entries</span>
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
                      <span className="w-20 shrink-0">Strict scope</span>
                      <input
                        className="field field-mono field-sm flex-1"
                        value={story.strictPattern}
                        placeholder={DEFAULT_STRICT_PATTERN}
                        onChange={(e) => onUpdate({ ...story, strictPattern: e.target.value })}
                      />
                    </label>
                  )}

                  <div className="flex justify-end">
                    <button onClick={() => onDelete(story.id)} className="btn-link btn-danger">
                      Delete story
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
