import qrcode from 'qrcode-generator';

/** Quiet zone around the code, in modules (the QR spec asks for 4). */
const MARGIN = 4;

/** Draws `text` as a black-on-white QR code filling the canvas (sized for sharp pixels at this screen's density). */
export function drawQr(canvas: HTMLCanvasElement, text: string, cssSize: number): void {
  const qr = qrcode(0, 'M'); // 0: smallest version that fits
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const total = n + MARGIN * 2;
  const cell = Math.max(1, Math.floor((cssSize * (window.devicePixelRatio || 1)) / total));
  canvas.width = canvas.height = cell * total;
  canvas.style.width = canvas.style.height = `${cssSize}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) g.fillRect((c + MARGIN) * cell, (r + MARGIN) * cell, cell, cell);
    }
  }
}
