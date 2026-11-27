/** 内联图示的沙箱文档：iframe 里跑的那份 HTML + 自动缩放脚本。 */

const CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;"

/** 内联图示的最大显示高度：超过就整体缩小，不出滚动条 */
export const MAX_HEIGHT = 460

/** 父页面 → iframe：外层宽度变了，重新算一次缩放 */
export const REFIT_MESSAGE = "zhishi-inline-html-refit"
/** iframe → 父页面：报新的显示高度 */
export const HEIGHT_MESSAGE = "zhishi-inline-html-height"

/**
 * 内联 HTML 片段：沙箱 iframe + 自动缩放（聊天流里的小图案/示意图）。
 *
 * 内容超过可用宽/高时按比例缩小到装下，**不出现滚动条**——
 * 内联小图出现滚动条体验很差，宁可整体缩一点。
 */
export function wrapInlineHtml(fragment: string, maxHeight: number): string {
  const fitScript = `(function(){
  var root=document.getElementById('zhishi-inline-fit');
  if(!root) return;
  var MAX_H=${maxHeight};
  var lastW=-1, lastH=-1, busy=false;

  // 模型常写 <svg viewBox="0 0 800 300"> 不带 width/height。
  // 这种 svg 在 CSS 里高度算出来是 0（图直接不见了），按 viewBox 比例补一个尺寸。
  function normalizeSvg(){
    var availW=Math.max(1, document.documentElement.clientWidth||window.innerWidth||1);
    var svgs=root.getElementsByTagName('svg');
    for(var i=0;i<svgs.length;i++){
      var s=svgs[i];
      if(s.getAttribute('data-zhishi-sized')) continue;
      var w0=parseFloat(s.getAttribute('width')||'');
      var h0=parseFloat(s.getAttribute('height')||'');
      if(w0>0 && h0>0) continue;
      var vb=(s.getAttribute('viewBox')||'').trim().split(/[\\s,]+/);
      if(vb.length!==4) continue;
      var vw=parseFloat(vb[2]), vh=parseFloat(vb[3]);
      if(!(vw>0)||!(vh>0)) continue;
      var w=Math.min(vw, availW);
      if(w0>0) w=Math.min(w0, availW);
      var h=w*vh/vw;
      if(h0>0) h=h0;
      // 必须走 inline style：上面的 CSS 有 svg{height:auto}，会盖掉 height 属性
      s.style.width=Math.round(w)+'px';
      s.style.height=Math.round(h)+'px';
      s.setAttribute('data-zhishi-sized','1');
    }
  }

  // 把所有可能溢出的几何都算进来：scrollWidth 会漏掉「包含块不在 root 内」的
  // 绝对定位元素，所以再遍历一遍后代，取最远的右/下边界。
  function measure(){
    root.style.transform='none';
    document.body.style.width='auto';
    document.body.style.height='auto';
    var w=Math.max(root.scrollWidth, root.offsetWidth, document.body.scrollWidth, 1);
    var h=Math.max(root.scrollHeight, root.offsetHeight, document.body.scrollHeight, 1);
    var base=root.getBoundingClientRect();
    var nodes=root.getElementsByTagName('*');
    // 画满点的 canvas/svg 可能有上千个节点，逐个量太慢；这种情况只信 scrollWidth
    if(nodes.length<=800){
      for(var i=0;i<nodes.length;i++){
        var r=nodes[i].getBoundingClientRect();
        if(!r.width && !r.height) continue;
        var right=r.right-base.left, bottom=r.bottom-base.top;
        if(right>w) w=right;
        if(bottom>h) h=bottom;
      }
    }
    return {w:Math.ceil(w), h:Math.ceil(h)};
  }

  function fit(){
    if(busy) return;
    busy=true;
    try{
      normalizeSvg();
      var box=measure();
      // 用 documentElement.clientWidth 而不是 innerWidth：iOS 的 iframe 没有
      // viewport meta 时会报 980 的布局宽度，按它算会漏缩放。
      var availW=Math.max(1, document.documentElement.clientWidth||window.innerWidth||1);
      var scale=Math.min(1, availW/box.w, MAX_H/box.h);
      if(!isFinite(scale)||scale<=0) scale=1;
      root.style.transformOrigin='top left';
      root.style.transform = scale<1 ? 'scale('+scale+')' : 'none';
      var shownW=Math.max(1, Math.ceil(box.w*scale));
      var shownH=Math.max(1, Math.ceil(box.h*scale));
      document.body.style.width=shownW+'px';
      document.body.style.height=shownH+'px';
      if(shownW===lastW && shownH===lastH) return;
      lastW=shownW; lastH=shownH;
      try{ parent.postMessage({type:'${HEIGHT_MESSAGE}', height:shownH}, '*'); }catch(e){}
    } finally { busy=false; }
  }

  function refit(){ lastW=-1; lastH=-1; fit(); }

  window.addEventListener('load', refit);
  window.addEventListener('resize', refit);
  window.addEventListener('message', function(e){
    var d=e.data;
    // 只认宿主页面发来的 refit；沙箱里的内容自己 postMessage 不该触发重算
    if(e.source!==parent) return;
    if(d && d.type==='${REFIT_MESSAGE}') refit();
  });
  if(window.ResizeObserver){
    try{ new ResizeObserver(refit).observe(root); }catch(e){}
  }
  setTimeout(refit, 0);
  setTimeout(refit, 120);
  setTimeout(refit, 400);
})();`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:transparent;color:#14212B;
    font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.5;}
  #zhishi-inline-fit{display:inline-block;vertical-align:top;}
  img,svg,canvas{max-width:100%;height:auto;display:block;margin:0 auto;}
  table{border-collapse:collapse;} td,th{padding:2px 6px;}
</style>
</head>
<body><div id="zhishi-inline-fit">${fragment}</div>
<script>${fitScript}</script>
</body>
</html>`
}
