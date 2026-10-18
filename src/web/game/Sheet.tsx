import { useEffect, useRef } from 'preact/hooks';
import { Button } from './ui';

interface Props {
  title: string;
  sentence: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * DESIGN 5.2 Bottom sheet for the two irreversible actions. Native <dialog> + showModal(): focus is
 * trapped, Escape and a backdrop tap cancel, focus returns to the trigger.
 */
export function Sheet({ title, sentence, confirm, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      trigger?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-labelledby="sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        const r = event.currentTarget.getBoundingClientRect();
        const outside = event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom;
        if (outside) onCancel();
      }}
    >
      <h2 id="sheet-title">{title}</h2>
      <p>{sentence}</p>
      <div class="row">
        <Button variant="primary" onClick={onConfirm}>
          {confirm}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </dialog>
  );
}
