import { useEffect, useMemo, useState } from 'react';
import type { WorldLibraryEntry } from '../types';
import type { PhotoBulkPatch } from '../hooks/useAlbum';
import { Modal } from '../components/Modal';

interface BulkEditDialogProps {
  open: boolean;
  count: number;
  worlds: WorldLibraryEntry[];
  onClose: () => void;
  onApply: (patch: PhotoBulkPatch) => void;
}

/**
 * Apply world / date / note / tag / favourite changes to the current selection.
 * Empty fields mean "leave unchanged", so a batch edit never overwrites data
 * the curator did not explicitly touch.
 */
export function BulkEditDialog({
  open,
  count,
  worlds,
  onClose,
  onApply,
}: BulkEditDialogProps) {
  const [worldChoice, setWorldChoice] = useState('keep');
  const [date, setDate] = useState('');
  const [noteAppend, setNoteAppend] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [clearTags, setClearTags] = useState(false);
  const [favoriteChoice, setFavoriteChoice] = useState<'keep' | 'on' | 'off'>('keep');

  useEffect(() => {
    if (!open) return;
    setWorldChoice('keep');
    setDate('');
    setNoteAppend('');
    setTagsInput('');
    setClearTags(false);
    setFavoriteChoice('keep');
  }, [open]);

  const tags = useMemo(
    () =>
      tagsInput
        .split(/[,，、\n]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tagsInput],
  );

  const hasChange =
    worldChoice !== 'keep' ||
    Boolean(date) ||
    Boolean(noteAppend.trim()) ||
    tags.length > 0 ||
    clearTags ||
    favoriteChoice !== 'keep';

  const apply = () => {
    if (!hasChange) return;
    const patch: PhotoBulkPatch = {};
    if (worldChoice === 'clear') patch.worldKey = null;
    else if (worldChoice !== 'keep') patch.worldKey = worldChoice;
    if (date) {
      const parsed = new Date(`${date}T12:00:00`);
      if (!Number.isNaN(parsed.getTime())) patch.capturedAt = parsed.toISOString();
    }
    if (noteAppend.trim()) patch.noteAppend = noteAppend.trim();
    if (tags.length) patch.tagsAdd = tags;
    if (clearTags) patch.tagsClear = true;
    if (favoriteChoice === 'on') patch.favorite = true;
    if (favoriteChoice === 'off') patch.favorite = false;
    onApply(patch);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="bulk-edit-title"
      className="bulk-edit-modal"
    >
      <div className="bulk-edit">
        <header className="bulk-edit__head">
          <p className="section-kicker">BATCH EDIT</p>
          <h2 id="bulk-edit-title">批量编辑 {count} 张照片</h2>
          <p>只填写需要修改的字段；留空表示保持原样。</p>
        </header>

        <div className="bulk-edit__grid">
          <label className="field">
            <span className="field-label">世界</span>
            <select
              className="admin-select"
              value={worldChoice}
              onChange={(event) => setWorldChoice(event.target.value)}
            >
              <option value="keep">不修改</option>
              <option value="clear">清除世界关联</option>
              {worlds.map((world) => (
                <option key={world.key} value={world.key}>
                  {world.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">拍摄日期</span>
            <div className="input-shell">
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </label>

          <label className="field bulk-edit__wide">
            <span className="field-label">追加备注</span>
            <div className="input-shell">
              <input
                type="text"
                value={noteAppend}
                maxLength={200}
                placeholder="会追加到现有备注后面，不覆盖原文"
                onChange={(event) => setNoteAppend(event.target.value)}
              />
            </div>
          </label>

          <label className="field bulk-edit__wide">
            <span className="field-label">添加标签</span>
            <div className="input-shell">
              <input
                type="text"
                value={tagsInput}
                maxLength={200}
                placeholder="用逗号分隔，例如：夜景, 合影, 2026"
                onChange={(event) => setTagsInput(event.target.value)}
              />
            </div>
            <span className="field-hint">最多 20 个标签，每个 24 字以内。</span>
          </label>

          <label className="field-inline">
            <input
              type="checkbox"
              checked={clearTags}
              onChange={(event) => setClearTags(event.target.checked)}
            />
            <span>清空原有标签</span>
          </label>

          <label className="field">
            <span className="field-label">收藏</span>
            <select
              className="admin-select"
              value={favoriteChoice}
              onChange={(event) =>
                setFavoriteChoice(event.target.value as 'keep' | 'on' | 'off')
              }
            >
              <option value="keep">不修改</option>
              <option value="on">设为收藏</option>
              <option value="off">取消收藏</option>
            </select>
          </label>
        </div>

        <footer className="bulk-edit__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={apply}
            disabled={!hasChange || count === 0}
          >
            应用到 {count} 张照片
          </button>
        </footer>
      </div>
    </Modal>
  );
}
