/** Export the rendered chart (SVG) as PNG with resolved theme colors. Runs fully client-side. */
export async function exportChartPng(container: HTMLElement | null, filename: string) {
  const svg = container?.querySelector('svg.recharts-surface');
  if (!svg) return;
  const styles = getComputedStyle(document.documentElement);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  let markup = new XMLSerializer().serializeToString(clone);
  markup = markup.replace(/var\((--[\w-]+)\)/g, (_, v: string) => styles.getPropertyValue(v).trim() || '#000');
  const bg = styles.getPropertyValue('--surface').trim();
  const muted = styles.getPropertyValue('--muted').trim();
  markup = markup.replace('<svg ', `<svg style="font-family: Inter, sans-serif" `).replace(/class="recharts-text/g, `fill="${muted}" class="recharts-text`);
  const img = new Image();
  const scale = 2;
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = rej;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
  });
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  a.click();
}
