// Small shared pieces: icon, button, seat stone, mark.
import type { ComponentChildren, JSX } from 'preact';
import { ICONS, type IconName } from '../icon-paths';

export function Icon({ name, size = 20, class: cls = '' }: { name: IconName; size?: 16 | 20; class?: string }) {
  return (
    <svg class={`icon ${size === 16 ? 'icon-16' : ''} ${cls}`} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <path d={ICONS[name]} />
    </svg>
  );
}

type ButtonProps = {
  variant: 'primary' | 'secondary' | 'quiet';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (event: MouseEvent) => void;
  children: ComponentChildren;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'icon'>;

/** DESIGN 5.2 Button. Disabled keeps focusability via aria-disabled and swallows clicks. */
export function Button({ variant, icon, disabled, loading, onClick, children, ...rest }: ButtonProps) {
  const inert = disabled || loading;
  return (
    <button
      type="button"
      class={`btn btn-${variant}`}
      aria-disabled={inert ? 'true' : undefined}
      onClick={(event) => {
        if (inert) return;
        onClick?.(event);
      }}
      {...rest}
    >
      {loading ? <span class="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Mark({ size }: { size: number }) {
  return <img src="/kido-mark.svg" width={size} height={size} alt="" />;
}
