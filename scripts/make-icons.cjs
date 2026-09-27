// Renders the app and tray icons from build/*.svg into PNG/ICO files.
// Run: npx electron scripts/make-icons.cjs   (Linux without display: xvfb-run -a npx electron --no-sandbox scripts/make-icons.cjs)

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const BUILD = path.join(__dirname, '..', 'build');

function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(png.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((x) => x.png)]);
}

app.whenReady().then(async () => {
  // one page with all sources side by side; regions are captured individually
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden;position:relative">
    <img style="position:absolute;left:0;top:0" width="512" height="512" src="icon.svg">
    <img style="position:absolute;left:512;top:0" width="64" height="64" src="tray.svg">
    <img style="position:absolute;left:576;top:0" width="64" height="64" src="trayTemplate.svg">
  </body></html>`;
  const tmp = path.join(BUILD, '.render.html');
  fs.writeFileSync(tmp, html.replace(/left:(\d+);/g, 'left:$1px;'));
  const win = new BrowserWindow({ width: 640, height: 512, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadFile(tmp);
  await new Promise((r) => setTimeout(r, 500));
  const icon = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const tray = await win.webContents.capturePage({ x: 512, y: 0, width: 64, height: 64 });
  const tmpl = await win.webContents.capturePage({ x: 576, y: 0, width: 64, height: 64 });
  fs.rmSync(tmp);
  const big = icon.resize({ width: 512, height: 512, quality: 'best' });
  fs.writeFileSync(path.join(BUILD, 'icon.png'), big.toPNG());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico(sizes.map((s) => ({ size: s, png: big.resize({ width: s, height: s, quality: 'best' }).toPNG() }))));
  fs.writeFileSync(path.join(BUILD, 'tray.png'), tray.resize({ width: 32, height: 32, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(BUILD, 'tray@2x.png'), tray.resize({ width: 64, height: 64, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(BUILD, 'trayTemplate.png'), tmpl.resize({ width: 22, height: 22, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(BUILD, 'trayTemplate@2x.png'), tmpl.resize({ width: 44, height: 44, quality: 'best' }).toPNG());
  console.log('icons written to', BUILD);
  win.destroy();
  app.quit();
});
