/** DESIGN 4.3 header: lockup link to / on the left, meta line on the right. */
export function Header({ meta }: { meta: string | null }) {
  return (
    <header class="header">
      <a class="lockup" href="/" aria-label="Kido home">
        <img src="/kido-mark.svg" width={28} height={28} alt="" />
        <span>kido</span>
      </a>
      {meta && <span class="meta">{meta}</span>}
    </header>
  );
}
