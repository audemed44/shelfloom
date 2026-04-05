import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../../api/client'
import GenreCombobox from '../shared/GenreCombobox'
import TagCombobox from '../shared/TagCombobox'
import type { Genre, Tag, Shelf, BulkBookActionResponse } from '../../types/api'

interface BulkEditModalProps {
  selectedIds: Set<string>
  shelves: Shelf[]
  onClose: () => void
  onSuccess: () => void
}

type Phase = 'edit' | 'submitting' | 'result'

export default function BulkEditModal({
  selectedIds,
  shelves,
  onClose,
  onSuccess,
}: BulkEditModalProps) {
  // Metadata state
  const [addGenres, setAddGenres] = useState<Genre[]>([])
  const [removeGenres, setRemoveGenres] = useState<Genre[]>([])
  const [addTags, setAddTags] = useState<Tag[]>([])
  const [removeTags, setRemoveTags] = useState<Tag[]>([])

  // Move state
  const [targetShelfId, setTargetShelfId] = useState<number | ''>('')
  const [moveConfirmed, setMoveConfirmed] = useState(false)

  // Submission
  const [phase, setPhase] = useState<Phase>('edit')
  const [metadataResult, setMetadataResult] =
    useState<BulkBookActionResponse | null>(null)
  const [moveResult, setMoveResult] = useState<BulkBookActionResponse | null>(
    null
  )

  const bookIds = Array.from(selectedIds)

  const hasMetadataChanges =
    addGenres.length > 0 ||
    removeGenres.length > 0 ||
    addTags.length > 0 ||
    removeTags.length > 0
  const hasMoveChange = targetShelfId !== '' && moveConfirmed
  const canApply = hasMetadataChanges || hasMoveChange

  const handleApply = async () => {
    setPhase('submitting')
    try {
      if (hasMetadataChanges) {
        const res = await api.post<BulkBookActionResponse>(
          '/api/books/bulk-metadata',
          {
            book_ids: bookIds,
            add_tag_ids: addTags.map((t) => t.id),
            remove_tag_ids: removeTags.map((t) => t.id),
            add_genre_ids: addGenres.map((g) => g.id),
            remove_genre_ids: removeGenres.map((g) => g.id),
          }
        )
        setMetadataResult(res)
      }
      if (hasMoveChange) {
        const res = await api.post<BulkBookActionResponse>(
          '/api/books/bulk-move',
          {
            book_ids: bookIds,
            target_shelf_id: targetShelfId,
          }
        )
        setMoveResult(res)
      }
    } finally {
      setPhase('result')
    }
  }

  const totalSucceeded =
    (metadataResult?.succeeded ?? 0) + (moveResult?.succeeded ?? 0)
  const totalFailed = (metadataResult?.failed ?? 0) + (moveResult?.failed ?? 0)
  const failedItems = [
    ...(metadataResult?.results.filter((r) => !r.success) ?? []),
    ...(moveResult?.results.filter((r) => !r.success) ?? []),
  ]

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden border border-white/10 bg-black"
        data-testid="bulk-edit-modal"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-black px-6 py-4 shrink-0">
          <h2 className="text-lg font-black tracking-tighter">
            Edit {selectedIds.size} Books
          </h2>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div
          className="min-h-0 flex-1 overflow-y-auto px-6 py-6 space-y-8"
          data-testid="bulk-edit-modal-body"
        >
          {phase === 'result' ? (
            <div data-testid="bulk-result-summary">
              <p className="text-sm text-white/80 normal-case mb-4">
                {totalFailed === 0
                  ? `All ${totalSucceeded} operations succeeded.`
                  : `${totalSucceeded} succeeded, ${totalFailed} failed.`}
              </p>
              {failedItems.length > 0 && (
                <div className="space-y-1">
                  {failedItems.map((r, i) => (
                    <p
                      key={i}
                      className="text-xs text-red-400 normal-case truncate"
                    >
                      {r.book_id}: {r.error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Section 01: Metadata */}
              <div>
                <h3 className="text-[10px] font-black tracking-widest uppercase text-white/40 border-b border-white/10 pb-2 mb-6">
                  01 Metadata
                </h3>
                <div className="space-y-4">
                  <GenreCombobox value={addGenres} onChange={setAddGenres} />
                  <div>
                    <label className="block text-[10px] font-black tracking-widest uppercase text-white/40 mb-1.5">
                      Remove Genres
                    </label>
                    <GenreCombobox
                      value={removeGenres}
                      onChange={setRemoveGenres}
                    />
                  </div>
                  <TagCombobox
                    value={addTags}
                    onChange={setAddTags}
                    label="Add Tags"
                  />
                  <TagCombobox
                    value={removeTags}
                    onChange={setRemoveTags}
                    label="Remove Tags"
                  />
                </div>
              </div>

              {/* Section 02: Move */}
              <div>
                <h3 className="text-[10px] font-black tracking-widest uppercase text-white/40 border-b border-white/10 pb-2 mb-6">
                  02 Move to Shelf
                </h3>
                <select
                  value={targetShelfId}
                  onChange={(e) => {
                    setTargetShelfId(
                      e.target.value ? Number(e.target.value) : ''
                    )
                    setMoveConfirmed(false)
                  }}
                  className="w-full bg-black border border-white/10 px-4 py-3 text-sm text-white focus:border-primary focus:outline-none"
                  data-testid="bulk-move-shelf-select"
                >
                  <option value="">Select shelf...</option>
                  {shelves.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {targetShelfId !== '' && (
                  <label className="flex items-center gap-2 mt-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={moveConfirmed}
                      onChange={(e) => setMoveConfirmed(e.target.checked)}
                      className="accent-primary"
                      data-testid="bulk-move-confirm"
                    />
                    <span className="text-xs text-white/40 normal-case">
                      I understand this moves {selectedIds.size} book files on
                      disk
                    </span>
                  </label>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t border-white/10 bg-black px-6 py-4 shrink-0"
          data-testid="bulk-edit-modal-footer"
        >
          {phase === 'result' ? (
            <button
              onClick={onSuccess}
              className="px-6 py-3 bg-primary text-white text-[10px] font-black tracking-widest uppercase hover:bg-primary/90 transition-colors"
              data-testid="bulk-done-btn"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-6 py-3 border border-white/10 text-white/40 text-[10px] font-black tracking-widest uppercase hover:text-white hover:border-white/30 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                disabled={!canApply || phase === 'submitting'}
                className="px-6 py-3 bg-primary text-white text-[10px] font-black tracking-widest uppercase hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="bulk-apply-btn"
              >
                {phase === 'submitting' ? 'Applying...' : 'Apply'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
