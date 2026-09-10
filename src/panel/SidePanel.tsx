import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import RuleForm, { type RuleDraft } from './components/RuleForm';
import RuleList from './components/RuleList';
import ProfilesCard from './components/ProfilesCard';
import RecordedFieldsDialog from './components/RecordedFieldsDialog';
import SettingsCard from './components/SettingsCard';
import TabBar, { type TabId } from './components/TabBar';
import { IconPlus, IconSettings } from './components/icons';
import NetworkLogCard from './components/NetworkLogCard';
import StoriesCard from './components/StoriesCard';
import { useNetworkLog } from './hooks/useNetworkLog';
import {
  loadCases,
  loadCounters,
  loadProfiles,
  loadRules,
  loadSettings,
  loadStories,
  loadStoryEntries,
  removeStory,
  saveCases,
  saveCounters,
  saveProfiles,
  saveRules,
  saveSettings,
  saveStories,
  saveStoryEntries,
  normalizeSettings,
} from '../shared/storage';
import {
  applyCase,
  newCase,
  newProfile,
  uniqueCaseName,
  recordedToField,
  type FormCase,
  type FormProfile,
  type RecordedFieldInput,
  type ScreenSignature,
} from '../shared/form';
import { resolveProfile } from '../shared/resolveProfile';
import {
  activeTab,
  runFill,
  runPick,
  runRecord,
  runScreen,
  type FillOutcome,
  type ScreenOutcome,
} from '../inject/run';
import { collectGarbage, putBody, trimBodies, usageBytes } from '../shared/bodyStore';
import {
  downloadState,
  exportState,
  importState,
  type ImportMode,
  type ImportReport,
} from '../shared/portable';
import {
  addEntry,
  exchangeToEntry,
  newStory,
  referencedBodyKeys,
  type StoryMeta,
} from '../shared/story';
import { randomId } from '../shared/ids';
import { DEFAULT_SETTINGS, STORAGE_KEYS, type MutationRule, type Settings } from '../shared/types';

export default function SidePanel() {
  const [rules, setRules] = useState<MutationRule[]>([]);
  const [profiles, setProfiles] = useState<FormProfile[]>([]);
  const [profileId, setProfileId] = useState<string | undefined>(undefined);
  const [cases, setCases] = useState<FormCase[]>([]);
  const [caseId, setCaseId] = useState<string | undefined>(undefined);
  const [screen, setScreen] = useState<ScreenOutcome | undefined>(undefined);
  const [screenBusy, setScreenBusy] = useState(false);
  const [counters, setCounters] = useState<Record<string, number>>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [stories, setStories] = useState<StoryMeta[]>([]);
  const [editing, setEditing] = useState<MutationRule | undefined>(undefined);
  const [draft, setDraft] = useState<RuleDraft | undefined>(undefined);
  const [toast, setToast] = useState<ReactNode>(null);
  const [recorded, setRecorded] = useState<RecordedFieldInput[] | null>(null);
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [usage, setUsage] = useState(0);
  const [storageBusy, setStorageBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('network');
  const [mockView, setMockView] = useState<'rules' | 'stories'>('rules');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const log = useNetworkLog();

  useEffect(() => {
    void loadRules().then(setRules);
    void loadSettings().then(setSettings);
    void loadStories().then(setStories);
    void loadCounters().then(setCounters);
    void usageBytes().then(setUsage);
    void loadCases().then(setCases);
    void loadProfiles().then((loaded) => {
      setProfiles(loaded);
      setProfileId((current) => current ?? loaded[0]?.id);
    });
  }, []);

  // Keep the panel in sync if storage is changed elsewhere (another window, import…).
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      const ruleChange = changes[STORAGE_KEYS.rules];
      const profileChange = changes[STORAGE_KEYS.profiles];
      const settingsChange = changes[STORAGE_KEYS.settings];
      const storyChange = changes[STORAGE_KEYS.stories];
      const caseChange = changes[STORAGE_KEYS.cases];
      if (ruleChange) setRules((ruleChange.newValue as MutationRule[]) ?? []);
      if (profileChange) setProfiles((profileChange.newValue as FormProfile[]) ?? []);
      if (settingsChange) setSettings(normalizeSettings(settingsChange.newValue));
      if (storyChange) setStories((storyChange.newValue as StoryMeta[]) ?? []);
      if (caseChange) setCases((caseChange.newValue as FormCase[]) ?? []);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const persistRules = useCallback((next: MutationRule[]) => {
    setRules(next);
    void saveRules(next);
  }, []);

  const persistProfiles = useCallback((next: FormProfile[]) => {
    setProfiles(next);
    void saveProfiles(next);
  }, []);

  const persistCases = useCallback((next: FormCase[]) => {
    setCases(next);
    void saveCases(next);
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
      persistRules(
        rules.map((rule) => (rule.id === editing.id ? { ...rule, ...submitted } : rule)),
      );
      setEditing(undefined);
      setRuleFormOpen(false);
      return;
    }
    persistRules([...rules, { id: randomId('rl_'), isActive: true, ...submitted }]);
    setDraft(undefined);
    setRuleFormOpen(false);
  };

  const toggleRule = (id: string) =>
    persistRules(
      rules.map((rule) => (rule.id === id ? { ...rule, isActive: !rule.isActive } : rule)),
    );

  const deleteRule = (id: string) => {
    persistRules(rules.filter((rule) => rule.id !== id));
    if (editing?.id === id) setEditing(undefined);
  };

  const refreshUsage = () => void usageBytes().then(setUsage);

  const handleExport = async () => {
    try {
      downloadState(await exportState());
      showToast('Exported');
    } catch (err) {
      console.error('[Panel] Export failed:', err);
      showToast('Export failed — see console');
    }
  };

  const handleImport = async (file: File, mode: ImportMode) => {
    try {
      setStorageBusy(`Importing ${file.name}…`);
      const report = await importState(JSON.parse(await file.text()), mode);
      showToast(summarizeImport(report));
      // Storage listeners re-hydrate rules, profiles and cases; these two are read once.
      void loadStories().then(setStories);
      void loadCounters().then(setCounters);
      refreshUsage();
    } catch (err) {
      console.error('[Panel] Import failed:', err);
      showToast('Import failed — is that an export file?');
    } finally {
      setStorageBusy(null);
    }
  };

  const handleTrim = async (maxKb: number) => {
    setStorageBusy('Trimming…');
    const removed = await trimBodies(maxKb * 1024);
    setStorageBusy(null);
    refreshUsage();
    showToast(removed > 0 ? `Removed ${removed} large body(ies)` : 'Nothing was over the limit');
  };

  const handleCollectGarbage = async () => {
    setStorageBusy('Checking…');
    const entryLists = await Promise.all(stories.map((story) => loadStoryEntries(story.id)));
    const removed = await collectGarbage(referencedBodyKeys(entryLists));
    setStorageBusy(null);
    refreshUsage();
    showToast(removed > 0 ? `Deleted ${removed} unused body(ies)` : 'Nothing unused to delete');
  };

  const showToast = (message: ReactNode, ms = 2500) => {
    setToast(message);
    setTimeout(() => setToast(null), ms);
  };

  const handleCreateRule = (fromExchange: RuleDraft) => {
    setEditing(undefined);
    // A fresh object identity is what re-hydrates the form.
    setDraft({ ...fromExchange });
    setRuleFormOpen(true);
    setMockView('rules');
    setTab('mocks');
    showToast('Draft ready in Mocks — review, then save');
  };

  const editRule = (rule: MutationRule) => {
    setEditing(rule);
    setRuleFormOpen(true);
    setMockView('rules');
    setTab('mocks');
  };

  /**
   * Turns selected log rows into story entries. Bodies go to the content-addressed
   * store, so re-recording the same response costs nothing and repeat captures of
   * one endpoint become a replay sequence.
   */
  const saveToStory = async (
    exchangeIds: string[],
    target: { storyId?: string; name?: string },
  ) => {
    const existing = target.storyId
      ? stories.find((story) => story.id === target.storyId)
      : undefined;
    const story = existing ?? newStory(target.name?.trim() || `Story ${stories.length + 1}`);

    let entries = existing ? await loadStoryEntries(story.id) : [];
    let saved = 0;
    let skipped = 0;
    let cut = 0;

    for (const exchangeId of exchangeIds) {
      const meta = log.entries.find((entry) => entry.id === exchangeId);
      // Replayed traffic would record the mock as if it were real.
      if (!meta || meta.servedBy !== 'network' || meta.outcome === 'pending') {
        skipped += 1;
        continue;
      }
      const bodies = await log.fetchBody(exchangeId);
      const text = bodies.response?.text;
      if (!text) {
        skipped += 1;
        continue;
      }
      // Replaying a truncated body would serve the app broken JSON — worse than
      // letting the request through, because it fails inside the app instead.
      if (bodies.response?.truncated) {
        cut += 1;
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

    const notes = [
      skipped > 0 ? `skipped ${skipped}` : undefined,
      cut > 0 ? `${cut} too large to replay` : undefined,
    ].filter(Boolean);
    showToast(
      notes.length > 0
        ? `Saved ${saved} to “${story.name}” · ${notes.join(' · ')}`
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

  const activeProfile = profiles.find((profile) => profile.id === profileId);
  const profileCases = cases.filter((item) => item.profileId === profileId);
  const activeCase = profileCases.find((item) => item.id === caseId);
  /**
   * What a fill would actually type. The case is folded in here rather than at
   * the fill site so the preview column and the fill can never disagree about
   * which values are in play — a case that reads right and fills wrong is the
   * one failure mode a value editor cannot afford.
   */
  const cased = activeProfile ? applyCase(activeProfile, activeCase) : undefined;
  // Preview only: counters are drawn but not persisted until an actual fill.
  const previewed = cased
    ? resolveProfile(cased, { counters })
    : { fields: [], values: {}, counters, errors: [] };

  /**
   * Every page action goes to the tab this panel was opened for — not to
   * whichever tab happens to be focused, which may be a different one entirely
   * now that each tab carries its own panel.
   */
  const targetTab = async (): Promise<chrome.tabs.Tab | undefined> => {
    if (log.tabId === undefined) return activeTab();
    try {
      return await chrome.tabs.get(log.tabId);
    } catch {
      showToast('This panel’s tab is gone');
      return undefined;
    }
  };

  const reloadTab = async () => {
    const browserTab = await targetTab();
    if (browserTab?.id === undefined) return;
    await chrome.tabs.reload(browserTab.id);
  };

  const fillForm = async () => {
    if (!cased) return;
    try {
      const browserTab = await targetTab();
      if (browserTab?.id === undefined) return;

      const resolved = resolveProfile(cased, { counters });
      if (resolved.errors.length > 0) {
        showToast(resolved.errors[0]);
        return;
      }
      const outcome = await runFill(browserTab.id, resolved.fields);
      setCounters(resolved.counters);
      void saveCounters(resolved.counters);
      rememberProfileForTab(browserTab.url, cased.id);

      const unfilled =
        outcome.misses.length + outcome.skipped.length + outcome.rejected.length;
      showToast(<FillSummary outcome={outcome} />, unfilled > 0 ? 6000 : 2500);
    } catch (err) {
      console.error('[Panel] Fill failed:', err);
      showToast('Fill failed — see console');
    }
  };

  /** Lets the keyboard shortcut fill with whatever was last used on this site. */
  const rememberProfileForTab = (url: string | undefined, id: string) => {
    if (!url) return;
    try {
      const origin = new URL(url).origin;
      if (settings.lastProfileByOrigin[origin] === id) return;
      persistSettings({
        ...settings,
        lastProfileByOrigin: { ...settings.lastProfileByOrigin, [origin]: id },
      });
    } catch {
      // Not a normal page (chrome://, about:blank): nothing worth remembering.
    }
  };

  const pickField = async (fieldId?: string) => {
    if (!activeProfile) return;
    try {
      const browserTab = await targetTab();
      if (browserTab?.id === undefined) return;
      showToast('Click a field on the page…');

      const picked = await runPick(browserTab.id);
      if (!picked) {
        showToast('Picking cancelled');
        return;
      }

      if (fieldId) {
        updateProfile({
          ...activeProfile,
          fields: activeProfile.fields.map((field) =>
            field.id === fieldId ? { ...field, selectors: picked.selectors } : field,
          ),
        });
        showToast('Selector updated');
        return;
      }

      const field = recordedToField(
        { selectors: picked.selectors, value: picked.value ?? '', label: picked.label },
        activeProfile.fields.map((item) => item.key),
      );
      updateProfile({ ...activeProfile, fields: [...activeProfile.fields, field] });
      showToast(`Added “${field.key}”`);
    } catch (err) {
      console.error('[Panel] Pick failed:', err);
      showToast('Pick failed — see console');
    }
  };

  const recordForm = async (secrets = includeSecrets) => {
    if (!activeProfile) return;
    try {
      const browserTab = await targetTab();
      if (browserTab?.id === undefined) return;
      setIncludeSecrets(secrets);
      const found = await runRecord(browserTab.id, secrets);
      // An empty array is truthy, so without this the dialog opened with nothing
      // in it and the button read as broken rather than as having found nothing.
      if (found.length === 0) {
        showToast(
          secrets
            ? 'Nothing to read — no field on this page can be written to.'
            : 'Nothing to read here. Password fields are skipped unless you ask for them.',
          4000,
        );
        return;
      }
      setRecorded(found);
    } catch (err) {
      console.error('[Panel] Record failed:', err);
      showToast('Record failed — see console');
    }
  };

  const addRecordedFields = (selected: RecordedFieldInput[]) => {
    if (!activeProfile) return;
    const keys = activeProfile.fields.map((field) => field.key);
    const added = selected.map((entry) => {
      const field = recordedToField(entry, keys);
      keys.push(field.key);
      return field;
    });
    updateProfile({ ...activeProfile, fields: [...activeProfile.fields, ...added] });
    setRecorded(null);
    showToast(`Added ${added.length} field(s)`);
  };

  const updateProfile = (next: FormProfile) =>
    persistProfiles(profiles.map((profile) => (profile.id === next.id ? next : profile)));

  const createProfile = () => {
    const created = newProfile(`Profile ${profiles.length + 1}`);
    persistProfiles([...profiles, created]);
    setProfileId(created.id);
  };

  const duplicateProfile = () => {
    if (!activeProfile) return;
    const copy = {
      ...newProfile(`${activeProfile.name} copy`),
      fields: activeProfile.fields,
      vars: activeProfile.vars,
    };
    persistProfiles([...profiles, copy]);
    setProfileId(copy.id);
  };

  const deleteProfile = () => {
    if (!activeProfile) return;
    const remaining = profiles.filter((profile) => profile.id !== activeProfile.id);
    persistProfiles(remaining);
    // A case outlives nothing: its selectors are gone with the profile.
    persistCases(cases.filter((item) => item.profileId !== activeProfile.id));
    setProfileId(remaining[0]?.id);
  };

  const createCase = () => {
    if (!activeProfile) return;
    const created = newCase(activeProfile.id, uniqueCaseName(cases, activeProfile.id, 'Case'));
    persistCases([...cases, created]);
    setCaseId(created.id);
  };

  const updateCase = (next: FormCase) =>
    persistCases(cases.map((item) => (item.id === next.id ? next : item)));

  /**
   * A case lifted out of a captured response. It lands selected on the Fill
   * tab rather than silently in the list — the next thing anyone does with a
   * case built from a payload is check what it actually holds.
   */
  const saveCaseFromPayload = (formCase: FormCase) => {
    persistCases([...cases, formCase]);
    setProfileId(formCase.profileId);
    setCaseId(formCase.id);
    showToast(
      <span>
        Saved <span className="font-semibold">{formCase.name}</span> — open the Fill tab to use it
      </span>,
      4000,
    );
  };

  const deleteCase = () => {
    if (!activeCase) return;
    persistCases(cases.filter((item) => item.id !== activeCase.id));
    setCaseId(undefined);
  };

  /**
   * Which of the known screens the tab is showing. Every profile that carries a
   * signature is scored, not just the active one — the useful answer when a
   * fill misses everything is "you are on Service Detail", which needs the
   * other profiles in the comparison.
   */
  const checkScreen = async () => {
    // A blank row is a signature still being typed, not a text to match: left
    // in, its `total` could never be reached and no screen would ever be best.
    const signatures = profiles
      .map((profile) => ({
        id: profile.id,
        texts: (profile.screen?.texts ?? []).map((text) => text.trim()).filter(Boolean),
      }))
      .filter((signature) => signature.texts.length > 0);
    setScreenBusy(true);
    try {
      const browserTab = await targetTab();
      if (browserTab?.id === undefined) return;
      setScreen(await runScreen(browserTab.id, signatures));
    } catch (err) {
      console.error('[Panel] Screen check failed:', err);
      setScreen(undefined);
    } finally {
      setScreenBusy(false);
    }
  };

  /**
   * A wizard step change moves nothing the panel can observe — same URL, same
   * tab — so the score is refreshed when the Fill tab comes forward rather than
   * kept live. Cheap, and it is the moment the answer is about to matter.
   */
  useEffect(() => {
    if (tab !== 'fill') return;
    void checkScreen();
    // Advancing a wizard step means clicking the page and coming back, and the
    // return trip is a focus event. It is not every case the chip can go stale
    // in, but it is the one that happens, and it costs no timer.
    const refresh = () => void checkScreen();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, log.tabUrl]);

  const setScreenSignature = (next: ScreenSignature | undefined) => {
    if (!activeProfile) return;
    const { screen: _drop, ...rest } = activeProfile;
    updateProfile(next && next.texts.length > 0 ? { ...rest, screen: next } : rest);
  };

  // The worker is torn down whenever it idles; the panel reconnects itself, and
  // this is the only place the user can see that the log is momentarily behind.
  const reconnecting = !log.connected && !log.tabClosed && log.tabUrl !== undefined;

  const activeCount = rules.filter((rule) => rule.isActive).length;

  const activeStories = stories.filter((story) => story.isActive).length;

  return (
    <div className="relative flex h-screen flex-col bg-canvas">
      <header className="shrink-0">
        <div className="toolbar">
          <ConnectionDot
            tabClosed={log.tabClosed}
            reconnecting={reconnecting}
            pageConnected={log.pageConnected}
            recording={log.recording}
          />
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-mute"
            title={
              log.tabClosed
                ? 'The tab this panel belongs to was closed'
                : reconnecting
                  ? 'The background worker went idle — reconnecting'
                  : !log.pageConnected
                    ? 'No content script is running in this tab — reload it'
                    : log.tabUrl
            }
          >
            {log.tabClosed
              ? 'tab closed'
              : reconnecting
                ? 'reconnecting…'
                : (hostOf(log.tabUrl) ??
                  (log.connected ? 'waiting for the page…' : 'not connected'))}
          </span>
          <button
            onClick={() => persistSettings({ ...settings, enabled: !settings.enabled })}
            aria-pressed={settings.enabled}
            title={
              settings.enabled
                ? `Intercepting — ${activeCount} rule(s) and ${activeStories} story(ies) armed`
                : 'Interception is off — the page sees the real backend'
            }
            className={`btn btn-sm ${settings.enabled ? 'btn-on' : 'btn-secondary'}`}
          >
            {settings.enabled ? `Intercepting · ${activeCount + activeStories}` : 'Passthrough'}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn btn-sm btn-icon btn-ghost"
            title="Settings"
          >
            <IconSettings />
          </button>
        </div>

        <TabBar
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: 'network', label: 'Network', count: log.entries.length },
            { id: 'mocks', label: 'Mocks', count: activeCount + activeStories },
            { id: 'fill', label: 'Fill', count: activeProfile?.fields.length },
          ]}
        />
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col">
        {tab === 'network' && (
          <NetworkLogCard
            log={log}
            stories={stories}
            profiles={profiles}
            cases={cases}
            onCreateRule={handleCreateRule}
            onSaveCase={saveCaseFromPayload}
            onReloadTab={() => void reloadTab()}
            onSaveToStory={saveToStory}
          />
        )}

        {tab === 'mocks' &&
          (ruleFormOpen ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <RuleForm
                editing={editing}
                initialDraft={draft}
                onSubmit={handleSubmit}
                onCancel={() => {
                  setEditing(undefined);
                  setDraft(undefined);
                  setRuleFormOpen(false);
                }}
              />
            </div>
          ) : (
            <>
              <div className="toolbar">
                <div className="seg" role="tablist">
                  <button
                    role="tab"
                    aria-selected={mockView === 'rules'}
                    onClick={() => setMockView('rules')}
                    className="seg-item"
                  >
                    Rules
                    <span className="tabular-nums">{rules.length}</span>
                  </button>
                  <button
                    role="tab"
                    aria-selected={mockView === 'stories'}
                    onClick={() => setMockView('stories')}
                    className="seg-item"
                  >
                    Stories
                    <span className="tabular-nums">{stories.length}</span>
                  </button>
                </div>
                <span className="flex-1" />
                <span className="text-[11px] text-faint tabular-nums">
                  {mockView === 'rules' ? `${activeCount} active` : `${activeStories} playing`}
                </span>
                {mockView === 'rules' && (
                  <button
                    onClick={() => {
                      setEditing(undefined);
                      setDraft(undefined);
                      setRuleFormOpen(true);
                    }}
                    className="btn btn-sm btn-secondary"
                  >
                    <IconPlus />
                    New rule
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {mockView === 'rules' ? (
                  <RuleList
                    rules={rules}
                    onToggle={toggleRule}
                    onDelete={deleteRule}
                    onEdit={editRule}
                  />
                ) : (
                  <StoriesCard
                    stories={stories}
                    onUpdate={(story) =>
                      persistStories(stories.map((item) => (item.id === story.id ? story : item)))
                    }
                    onDelete={(storyId) => void deleteStory(storyId)}
                  />
                )}
              </div>
            </>
          ))}

        {tab === 'fill' && (
          <ProfilesCard
            profiles={profiles}
            activeId={profileId}
            cases={profileCases}
            activeCaseId={activeCase?.id}
            screen={screen}
            screenBusy={screenBusy}
            preview={previewed.values}
            errors={previewed.errors}
            disabled={log.tabClosed}
            onSelect={setProfileId}
            onSelectCase={setCaseId}
            onCreateCase={createCase}
            onChangeCase={updateCase}
            onDeleteCase={deleteCase}
            onCheckScreen={() => void checkScreen()}
            onChangeScreen={setScreenSignature}
            onChange={updateProfile}
            onCreate={createProfile}
            onDuplicate={duplicateProfile}
            onDelete={deleteProfile}
            onFill={() => void fillForm()}
            onRecord={() => void recordForm()}
            onPick={(fieldId) => void pickField(fieldId)}
          />
        )}

        {settingsOpen && (
          <SettingsCard
            settings={settings}
            usageBytes={usage}
            busy={storageBusy}
            onChange={persistSettings}
            onExport={() => void handleExport()}
            onImport={(file, mode) => void handleImport(file, mode)}
            onTrim={(maxKb) => void handleTrim(maxKb)}
            onCollectGarbage={() => void handleCollectGarbage()}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </main>

      {recorded && (
        <RecordedFieldsDialog
          fields={recorded}
          includeSecrets={includeSecrets}
          onToggleSecrets={(include) => void recordForm(include)}
          onAdd={addRecordedFields}
          onCancel={() => setRecorded(null)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-4 left-1/2 z-30 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-[var(--radius-lg)] border border-line-strong bg-raised px-3 py-2 text-[12px] text-ink shadow-[var(--shadow-float)]"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/**
 * Only what actually arrived. A fixed list reads "0 case(s)" on every file
 * written before cases existed, and a zero standing where the number the user
 * is checking should be is worse than saying nothing.
 */
function summarizeImport(report: ImportReport): string {
  const parts = [
    countOf(report.rules, 'rule'),
    countOf(report.profiles, 'profile'),
    countOf(report.cases, 'case'),
    countOf(report.stories, 'story', 'stories'),
  ].filter(Boolean);
  return parts.length > 0 ? `Imported ${parts.join(', ')}` : 'Nothing in that file to import';
}

function countOf(count: number, one: string, many = `${one}s`): string | undefined {
  return count > 0 ? `${count} ${count === 1 ? one : many}` : undefined;
}

/**
 * Four outcomes, four weights. A field the screen answered for — it belongs to
 * another step, or a checkbox disabled it — is not a fault, and listing it next
 * to a broken selector is what made a six-step wizard report most of itself as
 * missing on every fill. A rejection is the loudest of the four because it is
 * the only one the panel used to count as a success: the write went through and
 * the app threw it away, so the summary said twelve and the screen showed nine.
 */
function FillSummary({ outcome }: { outcome: FillOutcome }) {
  const hidden = outcome.skipped.filter((entry) => entry.why === 'hidden');
  const disabled = outcome.skipped.filter((entry) => entry.why === 'disabled');
  const why = [
    hidden.length > 0 ? `on another step: ${hidden.map((e) => e.key).join(', ')}` : undefined,
    disabled.length > 0 ? `disabled right now: ${disabled.map((e) => e.key).join(', ')}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  // The one outcome that can name its own fix: the field wants another format.
  const refused = outcome.rejected
    .map((entry) => `${entry.key}: wanted ${entry.wanted}, got ${entry.got}`)
    .join('\n');

  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      <span>
        Filled <span className="font-semibold tabular-nums">{outcome.filled.length}</span>
      </span>
      {outcome.skipped.length > 0 && (
        <span className="text-faint" title={why}>
          · skipped <span className="tabular-nums">{outcome.skipped.length}</span>
        </span>
      )}
      {outcome.rejected.length > 0 && (
        <span className="text-bad" title={`The page did not keep these:\n${refused}`}>
          · rejected <span className="font-semibold tabular-nums">{outcome.rejected.length}</span>
        </span>
      )}
      {outcome.misses.length > 0 && (
        <span
          className="text-warn"
          title={`Nothing on the page matched: ${outcome.misses.join(', ')}`}
        >
          · missed <span className="tabular-nums">{outcome.misses.length}</span>
        </span>
      )}
    </span>
  );
}

/**
 * The one place the panel says whether it is actually watching anything: red
 * while capturing, amber while the worker reconnects, muted when idle.
 */
function ConnectionDot({
  tabClosed,
  reconnecting,
  pageConnected,
  recording,
}: {
  tabClosed: boolean;
  reconnecting: boolean;
  pageConnected: boolean;
  recording: boolean;
}) {
  // A dark tab is amber even while recording: the button says it is capturing,
  // and nothing about the page can reach it.
  const tone = tabClosed
    ? 'bg-bad'
    : reconnecting || !pageConnected
      ? 'bg-warn'
      : recording
        ? 'bg-bad animate-[pulse-soft_1.4s_ease-in-out_infinite]'
        : 'bg-faint';
  return <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${tone}`} />;
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
