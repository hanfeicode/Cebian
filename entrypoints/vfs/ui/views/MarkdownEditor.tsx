/**
 * VFS 内的 Markdown 编辑器：CodeMirror + 自动保存回 VFS。
 *
 * 保存策略（与 EditorPanel 一致）：
 * - 内容变化后 500ms 防抖写入。
 * - Ctrl/Cmd+S、path 变化、卸载时立即 flush。
 * - 保存状态通过 onSaveStatus 回调上报给父组件显示在 Toolbar。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { CodeMirrorEditor } from '@/components/editor/CodeMirrorEditor';
import { vfs } from '@/lib/persistence/vfs';
import { t } from '@/lib/i18n';

const AUTOSAVE_DEBOUNCE_MS = 500;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'unsaved' | 'error';

interface MarkdownEditorProps {
  content: string;
  path: string;
  isDark: boolean;
  onContentChange: (content: string) => void;
  onSaveStatus: (status: SaveStatus) => void;
}

function MarkdownEditor({ content, path, isDark, onContentChange, onSaveStatus }: MarkdownEditorProps) {
  const [body, setBody] = useState(content);
  const [savedContent, setSavedContent] = useState(content);

  const pathRef = useRef(path);
  const bodyRef = useRef(body);
  const savedRef = useRef(savedContent);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 当前 body 实际对应的 path（防止切换文件时旧防抖写到新文件）
  const loadedPathRef = useRef(path);

  pathRef.current = path;
  bodyRef.current = body;
  savedRef.current = savedContent;

  const dirty = body !== savedContent;

  // ─── 保存状态上报 ───
  const reportStatus = useCallback((status: SaveStatus) => {
    onSaveStatus(status);
  }, [onSaveStatus]);

  // ─── 核心 flush ───
  const flush = useCallback(async () => {
    const p = pathRef.current;
    const c = bodyRef.current;
    if (p !== loadedPathRef.current) return;
    if (c === savedRef.current) return;
    reportStatus('saving');
    try {
      await vfs.writeFile(p, c);
      if (pathRef.current === p) {
        setSavedContent(c);
        reportStatus('saved');
      }
    } catch (err) {
      console.error('[MarkdownEditor] autosave failed', err);
      reportStatus('error');
      toast.error(t('vfs.saveFailed'), {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }, [reportStatus]);

  // ─── path 变化时 flush 上一个文件的待存内容 ───
  useEffect(() => {
    const prevPath = loadedPathRef.current;
    if (prevPath && prevPath !== path && bodyRef.current !== savedRef.current) {
      // 快照落盘上一个文件
      const snapshot = bodyRef.current;
      const saved = savedRef.current;
      if (snapshot !== saved) {
        vfs.writeFile(prevPath, snapshot).catch((err) => {
          console.error('[MarkdownEditor] flush-on-switch failed', err);
        });
      }
    }
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    loadedPathRef.current = path;
    setBody(content);
    setSavedContent(content);
    reportStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // ─── 防抖自动保存 ───
  useEffect(() => {
    if (body === savedContent) return;
    reportStatus('unsaved');
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void flush();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [body, savedContent, flush, reportStatus]);

  // ─── Ctrl/Cmd+S ───
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        void flush();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [flush]);

  // ─── 卸载时 flush ───
  useEffect(() => {
    return () => {
      if (bodyRef.current !== savedRef.current && loadedPathRef.current) {
        void flush();
      }
    };
  }, [flush]);

  // ─── visibilitychange / beforeunload ───
  useEffect(() => {
    const maybeFlush = () => {
      if (bodyRef.current !== savedRef.current && pathRef.current) {
        void flush();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') maybeFlush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', maybeFlush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', maybeFlush);
    };
  }, [flush]);

  // ─── "saved" 自动回落 "idle" ───
  useEffect(() => {
    if (body === savedContent) {
      const timer = setTimeout(() => reportStatus('idle'), 2000);
      return () => clearTimeout(timer);
    }
  }, [body, savedContent, reportStatus]);

  const handleChange = useCallback((value: string) => {
    setBody(value);
    onContentChange(value);
  }, [onContentChange]);

  return (
    <div className="h-full min-h-0">
      <CodeMirrorEditor
        value={body}
        onChange={handleChange}
        language="markdown"
        isDark={isDark}
        className="h-full"
      />
    </div>
  );
}

export type { SaveStatus };
export { MarkdownEditor };
