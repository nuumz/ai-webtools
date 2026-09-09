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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-3 border-b pb-2">
        <h2 className="font-semibold text-gray-700">Stories</h2>
        <span className="text-[11px] text-gray-400">
          {stories.length === 0 ? 'none yet' : `${activeCount} of ${stories.length} playing`}
        </span>
      </div>

      {stories.length === 0 ? (
        <p className="text-xs text-gray-400 italic">
          Record some traffic, tick the rows you want, then “Save to story”. Replaying a story
          serves those responses without touching the backend.
        </p>
      ) : (
        <div className="space-y-2">
          {stories.map((story) => (
            <div
              key={story.id}
              className={`border rounded-md ${story.isActive ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200'}`}
            >
              <div className="flex items-center gap-2 p-2">
                <input
                  type="checkbox"
                  checked={story.isActive}
                  onChange={(e) => onUpdate({ ...story, isActive: e.target.checked })}
                  title="Replay this story"
                />
                <input
                  className="flex-1 min-w-0 bg-transparent text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border rounded px-1 py-0.5"
                  value={story.name}
                  onChange={(e) => onUpdate({ ...story, name: e.target.value })}
                />
                <span className="text-[10px] text-gray-400 shrink-0">{story.entryCount} entries</span>
                <button
                  onClick={() => setExpandedId(expandedId === story.id ? null : story.id)}
                  className="text-[11px] text-slate-500 hover:underline"
                >
                  {expandedId === story.id ? 'Hide' : 'Options'}
                </button>
              </div>

              {expandedId === story.id && (
                <div className="border-t border-gray-200 p-2 space-y-2 bg-white">
                  <label className="flex items-center gap-2 text-[11px] text-gray-600">
                    <span className="w-20 shrink-0">Match on</span>
                    <select
                      className="border rounded p-1 text-[11px]"
                      value={story.matchOn}
                      onChange={(e) => onUpdate({ ...story, matchOn: e.target.value as MatchOn })}
                    >
                      <option value="path+query">path + query string</option>
                      <option value="path">path only</option>
                    </select>
                    <span className="text-gray-400">applies to newly saved entries</span>
                  </label>

                  <label className="flex items-center gap-2 text-[11px] text-gray-600">
                    <input
                      type="checkbox"
                      checked={story.strict}
                      onChange={(e) => onUpdate({ ...story, strict: e.target.checked })}
                    />
                    Strict — answer 501 for requests this story does not cover
                  </label>

                  {story.strict && (
                    <label className="flex items-center gap-2 text-[11px] text-gray-600">
                      <span className="w-20 shrink-0">Strict scope</span>
                      <input
                        className="border rounded p-1 font-mono text-[11px] flex-1"
                        value={story.strictPattern}
                        placeholder={DEFAULT_STRICT_PATTERN}
                        onChange={(e) => onUpdate({ ...story, strictPattern: e.target.value })}
                      />
                    </label>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => onDelete(story.id)}
                      className="text-[11px] text-red-600 hover:underline"
                    >
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
