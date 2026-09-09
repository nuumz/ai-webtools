import { useCallback, useEffect, useState } from 'react';
import RuleForm, { type RuleDraft } from './components/RuleForm';
import RuleList from './components/RuleList';
import AutoFillCard from './components/AutoFillCard';
import {
  loadFormFillFields,
  loadRules,
  saveFormFillFields,
  saveRules,
} from '../shared/storage';
import type { FormFillField, MutationRule } from '../shared/types';

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
  const [editing, setEditing] = useState<MutationRule | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void loadRules().then(setRules);
    void loadFormFillFields().then(setFormFields);
  }, []);

  // Keep the panel in sync if storage is changed elsewhere (another window, import…).
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'local') return;
      if (changes.mutationRules) setRules((changes.mutationRules.newValue as MutationRule[]) ?? []);
      if (changes.formFillFields) setFormFields((changes.formFillFields.newValue as FormFillField[]) ?? []);
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

  const handleSubmit = (draft: RuleDraft) => {
    if (editing) {
      persistRules(rules.map((rule) => (rule.id === editing.id ? { ...rule, ...draft } : rule)));
      setEditing(undefined);
      return;
    }
    persistRules([...rules, { id: crypto.randomUUID(), isActive: true, ...draft }]);
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

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-sm font-sans">
      <header className="bg-slate-900 text-white p-4 shadow-md flex justify-between items-center">
        <h1 className="font-bold text-lg">Dev Interceptor</h1>
        <button
          onClick={injectFormFill}
          className="bg-blue-600 hover:bg-blue-500 text-xs px-3 py-1.5 rounded-md transition-colors"
        >
          Auto-Fill Form
        </button>
      </header>

      <main className="p-4 flex-1 overflow-y-auto">
        <RuleForm editing={editing} onSubmit={handleSubmit} onCancel={() => setEditing(undefined)} />
        <AutoFillCard fields={formFields} onChange={persistFields} />

        <h2 className="font-semibold text-gray-700 mb-3">
          Rules <span className="text-gray-400 font-normal">({rules.filter((r) => r.isActive).length} active)</span>
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
