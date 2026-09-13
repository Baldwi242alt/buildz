import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export function useMobileNavigation(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
) {
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width:760px)").matches,
  );
  useEffect(() => {
    const query = matchMedia("(max-width:760px)");
    const changed = () => {
      setNarrow(query.matches);
      setOpen(false);
    };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, [setOpen]);
  useEffect(() => {
    if (!narrow || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    const sidebar = document.querySelector<HTMLElement>(".sidebar")!;
    const controls = () =>
      Array.from(
        sidebar.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href], select",
        ),
      ).filter((item) => item.getClientRects().length);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [narrow, open, setOpen]);
  return narrow;
}
