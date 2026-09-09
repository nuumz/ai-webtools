import { useCallback, useEffect, useState } from 'react';
import RuleForm, { type RuleDraft } from './components/RuleForm';
import RuleList from './components/RuleList';
import AutoFillCard from './components/AutoFillCard';
import NetworkLogCard from './components/NetworkLogCard';
import StoriesCard from './components/StoriesCard';
import { useNetworkLog } from './hooks/useNetworkLog';
import {
  loadFormFillFields,
  loadRules,
  loadSettings,
  loadStories,
  loadStoryEntries,
  removeStory,
  saveFormFillFields,
  saveRules,
  saveSettings,
  saveStories,
  saveStoryEntries,
  normalizeSettings,
} from '../shared/storage';
import { collectGarbage, putBody } from '../shared/bodyStore';
import {
  addEntry,
  exchangeToEntry,
  newStory,
  referencedBodyKeys,
  type StoryMeta,
} from '../shared/story';
import { randomId } from '../shared/ids';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type FormFillField,
  type MutationRule,
  type Settings,
} from '../shared/types';

/** Runs inside the inspected page: fills inputs and notifies the framework. */
function fillFormFields(fields: FormFillField[]): number {
  let filled = 0;
  for (const { selector, value } of fields) {
    if (!selector) continue;
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement) &&
        !(element instanceof HTMLSelectElement)) {
      continue;
    }

    if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
      element.checked = value === 'true' || value === '1';
    } else {
      // React/Vue track the value internally; go through the native setter so
      // the change is not swallowed by the framework's value tracker.
      const prototype =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, value);
      else (element as HTMLInputElement).value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    filled += 1;
  }
  return filled;
}

export default function SidePanel() {
  const [rules, setRules] = useState<MutationRule[]>([]);
  const [formFields, setFormFields] = useState<FormFillField[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stories, setStories] = useState<StoryMeta[]>([]);
  const [editing, setEditing] = useState<MutationRule | undefined>(undefined);
  const [draft, setDraft] = useState<RuleDraft | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const log = useNetworkLog();

  useEffect(() => {
    void loadRules().then(setRules);
    void loadFormFillFields().then(setFormFields);
    void loadSettings().then(setSettings);
    void loadStories().then(setStories);
  }, []);

  // Keep the panel in sync if storage is changed elsewhere (another window, import…).
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      const ruleChange = changes[STORAGE_KEYS.rules];
      const fieldChange = changes[STORAGE_KEYS.formFill];
      const settingsChange = changes[STORAGE_KEYS.settings];
      const storyChange = changes[STORAGE_KEYS.stories];
      if (ruleChange) setRules((ruleChange.newValue as MutationRule[]) ?? []);
      if (fieldChange) setFormFields((fieldChange.newValue as FormFillField[]) ?? []);
      if (settingsChange) setSettings(normalizeSettings(settingsChange.newValue));
      if (storyChange) setStories((storyChange.newValue as StoryMeta[]) ?? []);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const persistRules = useCallback((next: MutationRule[]) => {
    setRules(next);
    void saveRules(next);
  }, []);

  const persistFields = useCallback((next: FormFillField[]) => {
    setFormFields(next);
    void saveFormFillFields(next);
  }, []);

  const persistSettings = useCallback((next: Settings) => {
    setSettings(next);
    void saveSettings(next);
  }, []);

  const persistStories = useCallback((next: StoryMeta[]) => {
    setStories(next);
    void saveStories(next);
  }, []);

  const handleSubmit = (submitted: RuleDraft) => {
    if (editing) {
      persistRules(rules.map((rule) => (rule.id === editing.id ? { ...rule, ...submitted } : rule)));
      setEditing(undefined);
      return;
    }
    persistRules([...rules, { id: randomId('rl_'), isActive: true, ...submitted }]);
    setDraft(undefined);
  };

  const toggleRule = (id: string) =>
    persistRules(rules.map((rule) => (rule.id === id ? { ...rule, isActive: !rule.isActive } : rule)));

  const deleteRule = (id: string) => {
    persistRules(rules.filter((rule) => rule.id !== id));
    if (editing?.id === id) setEditing(undefined);
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  const handleCreateRule = (fromExchange: RuleDraft) => {
    setEditing(undefined);
    // A fresh object identity is what re-hydrates the form.
    setDraft({ ...fromExchange });
    showToast('Draft loaded below — review, then save');
  };

  /**
   * Turns selected log rows into story entries. Bodies go to the content-addressed
   * store, so re-recording the same response costs nothing and repeat captures of
   * one endpoint become a replay sequence.
   */
  const saveToStory = async (exchangeIds: string[], target: { storyId?: string; name?: string }) => {
    const existing = target.storyId ? stories.find((story) => story.id === target.storyId) : undefined;
    const story = existing ?? newStory(target.name?.trim() || `Story ${stories.length + 1}`);

    let entries = existing ? await loadStoryEntries(story.id) : [];
    let saved = 0;
    let skipped = 0;

    for (const exchangeId of exchangeIds) {
      const meta = log.entries.find((entry) => entry.id === exchangeId);
      // Replayed traffic would record the mock as if it were real.
      if (!meta || meta.servedBy !== 'network') {
        skipped += 1;
        continue;
      }
      const bodies = await log.fetchBody(exchangeId);
      const text = bodies.response?.text;
      if (!text) {
        skipped += 1;
        continue;
      }
      const bodyKey = await putBody(text);
      entries = addEntry(entries, exchangeToEntry(meta, bodyKey, story.matchOn));
      saved += 1;
    }

    await saveStoryEntries(story.id, entries);
    const updated: StoryMeta = { ...story, entryCount: entries.length };
    persistStories(
      existing
        ? stories.map((item) => (item.id === story.id ? updated : item))
        : [...stories, updated],
    );

    showToast(
      skipped > 0
        ? `Saved ${saved} to “${story.name}” · skipped ${skipped}`
        : `Saved ${saved} to “${story.name}”`,
    );
  };

  const deleteStory = async (storyId: string) => {
    const remaining = stories.filter((story) => story.id !== storyId);
    persistStories(remaining);
    await removeStory(storyId);
    // Drop bodies nothing references any more.
    const entryLists = await Promise.all(remaining.map((story) => loadStoryEntries(story.id)));
    await collectGarbage(referencedBodyKeys(entryLists));
  };

  const injectFormFill = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: fillFormFields,
        args: [formFields],
      });
      showToast(`Filled ${result?.result ?? 0} field(s)`);
    } catch (err) {
      console.error('[Panel] Auto-fill failed:', err);
      showToast('Auto-fill failed — see console');
    }
  };

  const activeCount = rules.filter((rule) => rule.isActive).length;

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-sm font-sans">
      <header className="bg-slate-900 text-white shadow-md">
        <div className="p-4 flex justify-between items-center">
          <div>
            <h1 className="font-bold text-lg leading-tight">Dev Interceptor</h1>
            <p className="text-[11px] text-slate-400 truncate max-w-[15rem]" title={log.tabUrl}>
              {log.tabUrl ?? (log.connected ? 'waiting for the page…' : 'not connected')}
            </p>
          </div>
          <button
            onClick={injectFormFill}
            className="bg-blue-600 hover:bg-blue-500 text-xs px-3 py-1.5 rounded-md transition-colors"
          >
            Auto-Fill Form
          </button>
        </div>
        <div className="px-4 pb-3 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => persistSettings({ ...settings, enabled: e.target.checked })}
            />
            <span className={settings.enabled ? 'text-emerald-400' : 'text-slate-400'}>
              {settings.enabled ? `Interception on (${activeCount})` : 'Interception off'}
            </span>
          </label>
        </div>
      </header>

      <main className="p-4 flex-1 overflow-y-auto">
        <NetworkLogCard
          log={log}
          capturing={settings.captureEnabled}
          stories={stories}
          onToggleCapture={() =>
            persistSettings({ ...settings, captureEnabled: !settings.captureEnabled })
          }
          onCreateRule={handleCreateRule}
          onSaveToStory={saveToStory}
        />

        <StoriesCard
          stories={stories}
          onUpdate={(story) =>
            persistStories(stories.map((item) => (item.id === story.id ? story : item)))
          }
          onDelete={(storyId) => void deleteStory(storyId)}
        />

        <RuleForm
          editing={editing}
          initialDraft={draft}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(undefined)}
        />
        <AutoFillCard fields={formFields} onChange={persistFields} />

        <h2 className="font-semibold text-gray-700 mb-3">
          Rules <span className="text-gray-400 font-normal">({activeCount} active)</span>
        </h2>
        <RuleList rules={rules} onToggle={toggleRule} onDelete={deleteRule} onEdit={setEditing} />
      </main>

      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-xs px-3 py-2 rounded-md shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
