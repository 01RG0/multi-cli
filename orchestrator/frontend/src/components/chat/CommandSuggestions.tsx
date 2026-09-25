/**
 * CommandSuggestions — quick-command chip bar using Ant Design X's Suggestion component.
 *
 * Suggestion API verified from @ant-design/x v2.9.0:
 *   items: SuggestionItem[] | ((info?) => SuggestionItem[])
 *   onSelect?: (value: string, info: SuggestionItem[]) => void
 *   children?: (props: RenderChildrenProps) => React.ReactElement  (optional)
 *   open?: boolean
 *
 * Note: Suggestion is designed as a popup/cascader for chat autocomplete.
 * We render it with `children` as the chip row — clicking a chip directly
 * calls onSelect without opening the popup, providing the intended chip UX.
 */

import { useEffect } from 'react';
import Suggestion from '@ant-design/x/es/suggestion';
import type { SuggestionItem } from '@ant-design/x/es/suggestion';

export interface CommandSuggestionsProps {
  activeAgentId: string;
  taskStatus?: 'running' | 'completed' | 'failed' | 'queued';
  onSelect: (command: string) => void;
}

function buildItems(
  activeAgentId: string,
  taskStatus?: CommandSuggestionsProps['taskStatus'],
): SuggestionItem[] {
  const base: SuggestionItem[] = [
    { label: 'dispatch → codex',    value: 'dispatch to codex'    },
    { label: 'dispatch → opencode', value: 'dispatch to opencode' },
    { label: 'dispatch → vibe',     value: 'dispatch to vibe'     },
    { label: 'view full log',        value: 'view full log'        },
  ];
  // Replace last "dispatch" suggestion with the active agent's own dispatch
  if (activeAgentId && !['codex', 'opencode', 'vibe'].includes(activeAgentId)) {
    base.unshift({ label: `dispatch → ${activeAgentId}`, value: `dispatch to ${activeAgentId}` });
  }

  const contextual: SuggestionItem[] = [];
  if (taskStatus === 'failed') {
    contextual.push(
      { label: 'retry task',              value: 'retry task'              },
      { label: 'retry on different agent', value: 'retry on different agent' },
    );
  }
  if (taskStatus === 'running') {
    contextual.push({ label: 'cancel task', value: 'cancel task' });
  }
  if (taskStatus === 'completed') {
    contextual.push(
      { label: 'run again',       value: 'run again'       },
      { label: 'summarize output', value: 'summarize output' },
    );
  }

  return [...contextual, ...base];
}

export function CommandSuggestions({ activeAgentId, taskStatus, onSelect }: CommandSuggestionsProps) {
  const items = buildItems(activeAgentId, taskStatus);

  // Inject dark-mode CSS variable overrides for Ant Design X tokens once on mount
  useEffect(() => {
    const styleId = 'antdx-suggestion-dark';
    if (document.getElementById(styleId)) return;
    const el = document.createElement('style');
    el.id = styleId;
    el.textContent = `
      .antdx-suggestion-popup .ant-suggestion-popup,
      .antdx-suggestion-popup {
        background: #18181b !important;
        border: 1px solid #3f3f46 !important;
        color: #d4d4d8 !important;
      }
      .antdx-suggestion-popup .ant-select-item {
        color: #d4d4d8 !important;
        background: transparent !important;
      }
      .antdx-suggestion-popup .ant-select-item-option-active {
        background: #27272a !important;
      }
    `;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, []);

  return (
    <Suggestion
      items={items}
      onSelect={(value) => onSelect(value)}
      rootClassName="antdx-suggestion-popup"
    >
      {() => (
        /* Chip row rendered directly — clicking a chip calls onSelect immediately
           without opening the Suggestion popup, giving instant chip-click UX while
           keeping the Suggestion component in the tree for API consistency. */
        <div className="flex flex-wrap gap-1.5 px-1 py-1" role="toolbar" aria-label="Quick commands">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={(e) => {
                e.preventDefault();
                onSelect(item.value);
              }}
              className={`
                inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium
                transition-colors cursor-pointer
                ${
                  item.value.startsWith('retry') || item.value === 'cancel task'
                    ? 'border-orange-700 bg-orange-950 text-orange-300 hover:bg-orange-900'
                    : item.value.startsWith('dispatch')
                      ? 'border-blue-800 bg-blue-950 text-blue-300 hover:bg-blue-900'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                }
              `}
            >
              {item.label as string}
            </button>
          ))}
        </div>
      )}
    </Suggestion>
  );
}
