interface ThumbnailCacheEntry {
  promise: Promise<unknown>;
  expires: number;
}
interface ThumbnailLoaderOptions {
  container: HTMLElement;
  fetchThumbnail: (kind: string, value: string) => Promise<unknown>;
}
export function createThumbnailLoader({ container, fetchThumbnail }: ThumbnailLoaderOptions) {
  const cache = new Map<string, ThumbnailCacheEntry>();
  let observer: IntersectionObserver | null = null;
  function load(img: HTMLImageElement) {
    if (!img.isConnected || img.dataset.requested) return;
    img.dataset.requested = '1';
    const { thumbnailKind: kind, thumbnailValue: value } = img.dataset;
    if (!kind || !value) return;
    const key = JSON.stringify([kind, value]);
    let cached = cache.get(key);
    if (!cached || cached.expires < Date.now()) {
      cached = {
        promise: fetchThumbnail(kind, value).catch(() => null),
        expires: Date.now() + 5 * 60 * 1000,
      };
      cache.set(key, cached);
      if (cache.size > 300) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
    cached.promise.then((data) => {
      if (
        !img.isConnected ||
        typeof data !== 'string' ||
        !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(data)
      )
        return;
      img.onload = () => {
        if (img.isConnected) {
          img.hidden = false;
          img.parentElement?.classList.add('has-thumbnail');
        }
      };
      img.onerror = () => {
        img.hidden = true;
        img.parentElement?.classList.remove('has-thumbnail');
      };
      img.src = data;
    });
  }
  return function hydrateThumbnails() {
    const images = container.querySelectorAll<HTMLImageElement>('img[data-thumbnail-kind]');
    if (typeof IntersectionObserver === 'undefined') {
      images.forEach(load);
      return;
    }
    if (!observer)
      observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            observer?.unobserve(entry.target);
            const image = entry.target.querySelector<HTMLImageElement>('img[data-thumbnail-kind]');
            if (image) load(image);
          }),
        { rootMargin: '120px' },
      );
    observer.disconnect();
    images.forEach((image) => {
      if (image.parentElement) observer?.observe(image.parentElement);
    });
  };
}
