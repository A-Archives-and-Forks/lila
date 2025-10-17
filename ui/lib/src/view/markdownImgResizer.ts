import { frag, type Prop } from '@/common';
import { clamp } from '@/algo';
import { json as xhrJson } from '@/xhr';

// resize images in toast WYSIWYGs and raw textarea previews.
// toast: UpdateImageHook.url - img src is updated in-place via ProseMirror hooks (bits/src/toastEditor.ts)
// textarea: UpdateImageHook.markdown - the whole markdown text is updated (bits/src/bits.markdownTextarea.ts)

export type UpdateImageHook =
  | { markdown: Prop<string> }
  | { url: (img: HTMLElement, newUrl: string, width: number) => void };

export type ResizeArgs = {
  root: HTMLElement;
  update: UpdateImageHook;
  designWidth?: number;
  origin?: string;
};

export async function wireMarkdownImgResizers({
  root,
  update,
  designWidth,
  origin,
}: ResizeArgs): Promise<void> {
  let rootStyle: CSSStyleDeclaration;
  let rootPadding: number;
  globalImageLinkRe ??= new RegExp(
    String.raw`!\[([^\n\]]*)\]\((${regexQuote(origin ?? 'http')}[^)\s]+[?&]path=([a-z]\w+:[a-z0-9]{12}:[a-z0-9]{8}\.\w{3,4})[^)]*)\)`,
    'gi',
  );

  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    if (img.closest('.markdown-img-resizer')) continue; // already wrapped
    if (origin && !img.src.startsWith(origin)) continue;
    await img.decode().catch(() => {});
    rootStyle ??= window.getComputedStyle(root);
    rootPadding ??= parseInt(rootStyle.paddingLeft) + parseInt(rootStyle.paddingRight);
    if (!isFinite(rootPadding)) rootPadding = 0;

    const pointerdown = async (down: PointerEvent) => {
      const handle = down.currentTarget as HTMLElement;
      const rootWidth = root.clientWidth - rootPadding;
      const imgClientRect = img.getBoundingClientRect();
      const aspectRatio = img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
      const isBottomDrag = handle.className.includes('bottom');
      const isCornerDrag = !isBottomDrag && imgClientRect.bottom - down.clientY < 18;
      const dir = handle.className.includes('left') ? -1 : 1;
      if (isCornerDrag) handle.style.cursor = dir === 1 ? 'nwse-resize' : 'nesw-resize';

      handle.setPointerCapture?.(down.pointerId);
      img.style.willChange = 'width,height';
      img.style.width = `${imgClientRect.width}px`;
      img.closest<HTMLElement>('.markdown-img-resizer')!.style.width = '';

      const pointermove = (move: PointerEvent) => {
        const deltaX = isCornerDrag
          ? dir * (move.clientX - down.clientX) + (aspectRatio * (move.clientY - down.clientY)) / 2
          : isBottomDrag
            ? (move.clientY - down.clientY) * aspectRatio
            : dir * 2 * (move.clientX - down.clientX);
        const viewportImgWidth = Math.round(
          clamp(imgClientRect.width + deltaX, { min: 128, max: rootWidth }),
        );
        img.style.width = `${viewportImgWidth}px`;
        img.dataset.resizeWidth = String(
          designWidth ? Math.round((viewportImgWidth * designWidth) / rootWidth) : viewportImgWidth,
        );
        img.dataset.widthRatio = String(viewportImgWidth / rootWidth);
      };
      const pointerup = async () => {
        handle.removeEventListener('pointermove', pointermove);
        handle.removeEventListener('pointerup', pointerup);
        handle.removeEventListener('pointercancel', pointerup);
        if (handle.hasPointerCapture(down.pointerId)) handle.releasePointerCapture(down.pointerId);
        img.style.willChange = '';
        handle.style.cursor = '';
        if ('url' in update) {
          const imageId = img.src.match(imageIdRe)?.[1];
          const { imageUrl } = await xhrJson(`/image-url/${imageId}?width=${img.dataset.resizeWidth}`);
          const preloadImg = new Image();
          preloadImg.src = imageUrl;
          await preloadImg.decode();
          update.url(img, imageUrl, Number(img.dataset.widthRatio)!);
          return;
        }
        const text = update.markdown();
        const link = [...text.matchAll(globalImageLinkRe)].find(l => l[2] === img.src);
        if (!link?.[1] || !img.dataset.widthRatio) return;
        const { imageUrl } = await xhrJson(`/image-url/${link[3]}?width=${img.dataset.resizeWidth}`);
        const before = text.slice(0, link.index);
        const after = text.slice(link.index! + link[0].length);
        update.markdown(before + `![${link[1]}](${imageUrl})` + after);
      };
      handle.addEventListener('pointermove', pointermove, { passive: true });
      handle.addEventListener('pointerup', pointerup, { passive: true });
      handle.addEventListener('pointercancel', pointerup, { passive: true });
      down.preventDefault();
    };
    for (const h of dragHandles(img)) {
      h.addEventListener('pointerdown', pointerdown, { passive: false });
    }
  }
}

export function wrapImg(arg: { img: HTMLImageElement } | { src: string; alt: string }): HTMLElement {
  const span = frag<HTMLElement>($html`
    <span class="markdown-img-container">
      <span>
        <i class="resize-handle right"></i>
        <i class="resize-handle bottom"></i>
        <i class="resize-handle left"></i>
      </span>
    </span>`);
  const img = 'img' in arg ? arg.img : frag<HTMLImageElement>(`<img src="${arg.src}" alt="${arg.alt}">`);
  if ('img' in arg) img.replaceWith(span);
  span.querySelector('span')?.prepend(img);
  return span;
}

export async function naturalSize(image: Blob): Promise<{ width: number; height: number }> {
  if ('createImageBitmap' in window) return window.createImageBitmap(image);
  const objectUrl = URL.createObjectURL(image);
  const img = new Image();
  try {
    img.src = objectUrl;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

let globalImageLinkRe: RegExp;
const imageIdRe = /&path=([a-z]\w+:[a-z0-9]{12}:[a-z0-9]{8}\.\w{3,4})&/i;

function dragHandles(img: HTMLImageElement): HTMLElement[] {
  const span = img.closest('.markdown-img-container') ?? wrapImg({ img });
  span.firstElementChild!.classList.add('markdown-img-resizer');
  return [...span.querySelectorAll<HTMLElement>('.resize-handle')];
}

function regexQuote(origin: string) {
  return origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
