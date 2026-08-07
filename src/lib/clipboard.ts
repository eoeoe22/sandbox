// Clipboard write with a same-tab fallback for contexts where
// `navigator.clipboard` is unavailable or throws — an insecure origin (a LAN
// IP, a `file://` copy of the build) most commonly. Shared by every "복사"
// button in the guide page (Codex.svelte's per-entry/list copy, GameGuideDoc's
// whole-document copy) so the fallback logic exists in exactly one place.

/** The pre-async-clipboard route: a hidden, selected textarea plus
 *  `document.execCommand('copy')`. Costs a dozen lines; the alternative is a
 *  copy button that silently does nothing on an insecure origin. */
function copyByExecCommand(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  // Off-screen but still focusable — `display: none` can't be selected.
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/** Copy `text` to the clipboard, trying the async API first. Never throws —
 *  the boolean result is the only signal a caller needs (flash "copied" vs
 *  "couldn't copy"). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyByExecCommand(text);
  }
}
