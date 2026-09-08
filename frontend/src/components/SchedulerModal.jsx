import "./SchedulerModal.css";

export default function SchedulerModal({ open, onClose, onAdd, children }) {
  if (!open) return null;

  return (
    <div className="scheduler-backdrop" onClick={onClose}>
      <div className="scheduler-modal" onClick={(e) => e.stopPropagation()}>
        <div className="scheduler-modal-header">
          <div className="panel-label">Scheduler</div>
          <div className="scheduler-header-actions">
            {onAdd && (
              <button type="button" className="scheduler-add-btn" aria-label="Add scheduled job" onClick={onAdd}>
                +
              </button>
            )}
            <button type="button" className="scheduler-close-btn" aria-label="Close scheduler" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="scheduler-modal-body">{children}</div>
      </div>
    </div>
  );
}
