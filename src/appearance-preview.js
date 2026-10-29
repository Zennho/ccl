import { SkinViewer } from 'skinview3d';

async function imageFrom(source) {
  const image = new Image();
  image.src = source;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  return image;
}
async function fallbackPreview(canvas, skin, cape, model) {
  canvas.width=280; canvas.height=350;
  const ctx=canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建预览画布');
  const image=await imageFrom(skin);
  ctx.imageSmoothingEnabled=false;
  const d=(sx,sy,sw,sh,x,y,w,h)=>ctx.drawImage(image,sx,sy,sw,sh,x,y,w,h);
  if(cape) { try { const back=await imageFrom(cape); ctx.drawImage(back,1,1,10,16,148,102,85,150); } catch {} }
  d(8,8,8,8,104,25,72,72); d(40,8,8,8,104,25,72,72);
  d(20,20,8,12,104,97,72,108); d(20,36,8,12,104,97,72,108);
  const arm=model==='slim'?3:4, aw=arm*9;
  d(44,20,arm,12,104-aw,97,aw,108); d(44,36,arm,12,104-aw,97,aw,108);
  if(image.height>=64) { d(36,52,arm,12,176,97,aw,108); d(52,52,arm,12,176,97,aw,108); }
  else d(44,20,arm,12,176,97,aw,108);
  d(4,20,4,12,104,205,36,108);
  if(image.height>=64) d(20,52,4,12,140,205,36,108); else d(4,20,4,12,140,205,36,108);
  return { is2d:true, dispose() { ctx.clearRect(0,0,canvas.width,canvas.height); }};
}
export async function createAppearancePreview(canvas, skin, cape, model) {
  if (!skin) throw new Error('请先选择皮肤');
  let viewer;
  try {
    if (!window.WebGLRenderingContext) return await fallbackPreview(canvas,skin,cape,model);
    viewer = new SkinViewer({ canvas, width: 280, height: 350 });
    viewer.autoRotate = false;
    viewer.resetCameraPose();
    viewer.controls.enableRotate = true;
    viewer.controls.enableZoom = false;
    await viewer.loadSkin(skin, { model: model === 'slim' ? 'slim' : 'default' });
    if (cape) await viewer.loadCape(cape);
    return viewer;
  } catch (error) {
    if(viewer) viewer.dispose();
    // A canvas that already owns a WebGL context cannot be reused as 2D.
    // Keep the 3D error visible when that browser cannot initialize the renderer.
    if(canvas.getContext('2d')) return fallbackPreview(canvas,skin,cape,model);
    throw error;
  }
}
