/* 동글랜드 시세 추이 패널 — 룬 계산기와 요리사 계산기가 같이 쓰는 파일
 *
 * 하는 일
 *  1) GitHub에 쌓인 시세 파일(prices.json)을 불러온다 (실패하면 마지막으로 받은 걸 씀)
 *  2) 품목별 지금 가격 카드 + 30일 그래프를 그린다
 *  3) 최신 가격을 계산기에 넘겨준다 (onData)
 *
 * 쓰는 법:  DongleTracker.mount(document.getElementById('trend'), {shop:'alch', onData:function(info){...}})
 */
(function(){
"use strict";

/* 시세 파일 주소 — 저장소 이름이 바뀌면 여기만 고치면 됨 */
var DATA_URL='https://raw.githubusercontent.com/kpar03004-droid/dongle/main/data/prices.json';
var CACHE_KEY='dongle-prices:cache:v1';
var SLOT=3*3600;            // 3시간(초)
var DAY=86400;

var fmt=function(n,d){d=d||0;if(n==null||!isFinite(n))return '–';return n.toLocaleString('ko-KR',{minimumFractionDigits:d,maximumFractionDigits:d});};
var esc=function(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
/* 한국 시간으로 표시 (아이패드 설정과 상관없이) */
function kst(t,opt){ return new Date(t*1000).toLocaleString('ko-KR',Object.assign({timeZone:'Asia/Seoul'},opt)); }
function kstDay(t){ return kst(t,{year:'numeric',month:'2-digit',day:'2-digit'}); }
function kstShort(t){ var d=new Date((t+9*3600)*1000), p=function(n){return (n<10?'0':'')+n;};
  return (d.getUTCMonth()+1)+'/'+d.getUTCDate()+' '+p(d.getUTCHours())+':'+p(d.getUTCMinutes()); }

/* ---------- 스타일 (계산기 페이지의 색 변수를 그대로 씀) ---------- */
var CSS=''+
'.dt{border:1px solid var(--line);border-radius:14px;background:var(--surface);padding:18px 18px 14px;margin:28px 0}'+
'.dt-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;margin-bottom:12px}'+
'.dt-head h3{margin:0;font-size:1.05rem}'+
'.dt-status{font-size:.82rem;color:var(--text-2)}'+
'.dt-status .warn{color:var(--warn)}.dt-status .bad{color:var(--bad)}'+
'.dt-grp{font-family:var(--mono);font-size:.74rem;letter-spacing:.08em;color:var(--muted);margin:12px 0 6px}'+
'.dt-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}'+
'.dt-card{all:unset;box-sizing:border-box;cursor:pointer;display:block;border:1px solid var(--line-soft);border-radius:10px;background:var(--surface-2);padding:9px 11px 7px;min-width:0}'+
'.dt-card:hover{border-color:var(--line)}'+
'.dt-card[aria-pressed=true]{border-color:var(--amber);box-shadow:0 0 0 1px var(--amber) inset}'+
'.dt-card:focus-visible{outline:2px solid var(--amber);outline-offset:2px}'+
'.dt-name{font-size:.84rem;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
'.dt-price{font-family:var(--mono);font-size:1.35rem;font-weight:600;line-height:1.3}'+
'.dt-delta{font-family:var(--mono);font-size:.76rem;margin-left:6px;font-weight:500}'+
'.dt-up{color:var(--good)}.dt-down{color:var(--bad)}.dt-flat{color:var(--muted)}'+
'.dt-pos{height:4px;background:var(--ground);border-radius:2px;margin:5px 0 4px;overflow:hidden}'+
'.dt-pos i{display:block;height:100%;background:var(--amber)}'+
'.dt-spark{display:block;width:100%;height:26px}'+
'.dt-chartbox{margin-top:16px;border-top:1px solid var(--line-soft);padding-top:14px}'+
'.dt-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-bottom:8px}'+
'.dt-ctl strong{font-size:1rem}'+
'.dt-seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}'+
'.dt-seg button{all:unset;cursor:pointer;font-size:.8rem;padding:4px 10px;color:var(--text-2)}'+
'.dt-seg button[aria-pressed=true]{background:var(--surface-3);color:var(--text)}'+
'.dt-seg button:focus-visible{outline:2px solid var(--amber)}'+
'.dt-plot{position:relative;width:100%}'+
'.dt-plot svg{display:block;width:100%;touch-action:pan-y}'+
'.dt-tip{position:absolute;top:4px;pointer-events:none;background:var(--ground);border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:.78rem;white-space:nowrap;display:none}'+
'.dt-stats{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:.82rem;color:var(--text-2);margin-top:8px}'+
'.dt-stats b{color:var(--text);font-family:var(--mono);font-weight:600}'+
'.dt-empty{font-size:.86rem;color:var(--muted);padding:24px 0;text-align:center}';
function injectCss(){ if(document.getElementById('dt-css')) return; var s=document.createElement('style'); s.id='dt-css'; s.textContent=CSS; document.head.appendChild(s); }

/* ---------- 데이터 불러오기 ---------- */
function readCache(){ try{ return JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); }catch(e){ return null; } }
function writeCache(d){ try{ localStorage.setItem(CACHE_KEY,JSON.stringify(d)); }catch(e){} }
function load(){
  return fetch(DATA_URL+'?t='+Math.floor(Date.now()/60000),{cache:'no-store'})
    .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
    .then(function(d){ writeCache(d); return {data:d,from:'net'}; })
    .catch(function(err){ var c=readCache(); if(c) return {data:c,from:'cache',err:err}; throw err; });
}

/* 한 품목의 시세 기록 [[시각, 가격], …] */
function seriesOf(shop,key){
  var out=[]; shop.snaps.forEach(function(s){ if(s[1][key]!=null) out.push([s[0],s[1][key]]); }); return out;
}
/* 품목별 지금 가격 · 직전 가격 정리 */
function summarize(shop){
  return shop.items.map(function(it){
    var s=seriesOf(shop,it.key), last=s[s.length-1], prev=s[s.length-2];
    return Object.assign({},it,{price:last?last[1]:null,t:last?last[0]:null,prev:prev?prev[1]:null,series:s});
  });
}

/* ---------- 작은 그래프 (카드 안) ---------- */
function spark(series,lo,hi,now){
  var from=now-30*DAY, pts=bucketDaily(series.filter(function(p){return p[0]>=from;})).map(function(d){return [d.t,d.avg];});
  if(pts.length<2) return '<svg class="dt-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"></svg>';
  var ys=pts.map(function(p){return p[1];});
  var mn=Math.min.apply(null,lo!=null?ys.concat(lo):ys), mx=Math.max.apply(null,hi!=null?ys.concat(hi):ys); if(mx===mn) mx=mn+1;
  var t0=pts[0][0], t1=pts[pts.length-1][0]||t0+1; if(t1===t0) t1=t0+1;
  var d=pts.map(function(p,i){ return (i?'L':'M')+((p[0]-t0)/(t1-t0)*100).toFixed(2)+','+(24-(p[1]-mn)/(mx-mn)*22).toFixed(2); }).join('');
  return '<svg class="dt-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><path d="'+d+'" fill="none" stroke="var(--mint)" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>';
}

/* ---------- 큰 그래프 ---------- */
function bucketDaily(pts){
  var map={}, order=[];
  pts.forEach(function(p){ var k=kstDay(p[0]); if(!map[k]){ map[k]={t:p[0],v:[]}; order.push(k);} map[k].v.push(p[1]); });
  return order.map(function(k){ var v=map[k].v, sum=v.reduce(function(a,b){return a+b;},0);
    /* 그날 첫 칸 시각을 0시로 맞춤 */
    var t=map[k].t-((map[k].t+9*3600)%DAY);
    return {t:t+DAY/2,min:Math.min.apply(null,v),max:Math.max.apply(null,v),avg:sum/v.length,n:v.length}; });
}

function drawChart(box,item,opt){
  var plot=box.querySelector('.dt-plot'), tip=box.querySelector('.dt-tip');
  var W=Math.max(280,plot.clientWidth||600), H=W<520?190:230, L=40, R=10, T=12, B=24;
  var now=item.t||Date.now()/1000, from=now-opt.days*DAY;
  var pts=item.series.filter(function(p){return p[0]>=from;});
  var svgOld=plot.querySelector('svg'); if(svgOld) svgOld.remove();
  var stats=box.querySelector('.dt-stats');
  if(!pts.length){ plot.insertAdjacentHTML('afterbegin','<svg viewBox="0 0 '+W+' 60" height="60"><text x="'+W/2+'" y="34" text-anchor="middle" fill="var(--muted)" font-size="13">아직 기록이 없습니다</text></svg>'); stats.innerHTML=''; return; }
  var daily=opt.mode==='day'?bucketDaily(pts):null;
  var ys=pts.map(function(p){return p[1];});
  var mn=Math.min.apply(null,ys), mx=Math.max.apply(null,ys);
  if(item.lo!=null){ mn=Math.min(mn,item.lo); mx=Math.max(mx,item.hi); }
  var pad=Math.max(1,(mx-mn)*0.06); mn-=pad; mx+=pad;
  var x0=from, x1=now+(opt.mode==='day'?DAY/2:SLOT/2);
  var X=function(t){return L+(t-x0)/(x1-x0)*(W-L-R);}, Y=function(v){return T+(1-(v-mn)/(mx-mn))*(H-T-B);};
  var g=[];
  /* 가로 눈금 4개 */
  for(var i=0;i<=3;i++){ var v=mn+(mx-mn)*i/3, y=Y(v);
    g.push('<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line-soft)"/>');
    g.push('<text x="'+(L-6)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--mono)">'+Math.round(v)+'</text>'); }
  /* 상점 가격 범위(하한·상한) 점선 */
  if(item.lo!=null){ [['lo','하한 '],['hi','상한 ']].forEach(function(k){ var y=Y(item[k[0]]);
    g.push('<line x1="'+L+'" x2="'+(W-R)+'" y1="'+y+'" y2="'+y+'" stroke="var(--amber)" stroke-dasharray="4 4" opacity=".55"/>');
    g.push('<text x="'+(W-R-2)+'" y="'+(y-4)+'" text-anchor="end" font-size="10.5" fill="var(--amber)" opacity=".85">'+k[1]+item[k[0]]+'</text>'); }); }
  /* 날짜 눈금 */
  var step=opt.days<=7?DAY:(W<520?7*DAY:5*DAY);
  var firstMid=from-((from+9*3600)%DAY)+DAY;
  for(var t=firstMid;t<=x1;t+=step){ var x=X(t);
    g.push('<line x1="'+x+'" x2="'+x+'" y1="'+T+'" y2="'+(H-B)+'" stroke="var(--line-soft)" opacity=".6"/>');
    g.push('<text x="'+x+'" y="'+(H-7)+'" text-anchor="middle" font-size="11" fill="var(--muted)">'+kst(t,{month:'numeric',day:'numeric'})+'</text>'); }
  var hits=[];
  if(daily){
    /* 하루 최저~최고 막대 + 평균 선 */
    var bw=Math.max(3,Math.min(14,(W-L-R)/opt.days*0.55));
    daily.forEach(function(d){ var x=X(d.t);
      g.push('<rect x="'+(x-bw/2)+'" y="'+Y(d.max)+'" width="'+bw+'" height="'+Math.max(2,Y(d.min)-Y(d.max))+'" rx="2" fill="var(--mint)" opacity=".28"/>');
      hits.push({x:x,y:Y(d.avg),label:kst(d.t,{month:'numeric',day:'numeric'})+' · 평균 <b>'+fmt(d.avg)+'</b> · '+fmt(d.min)+'~'+fmt(d.max)+' ('+d.n+'회)'}); });
    g.push('<path d="'+daily.map(function(d,i){return (i?'L':'M')+X(d.t).toFixed(1)+','+Y(d.avg).toFixed(1);}).join('')+'" fill="none" stroke="var(--mint)" stroke-width="2" stroke-linejoin="round"/>');
  }else{
    /* 3시간 칸마다 점을 잇되, 수집이 빠진 구간(9시간 넘게 비면)은 끊음 */
    var d='';
    pts.forEach(function(p,i){ var gap=i&&p[0]-pts[i-1][0]>3*SLOT; d+=(i&&!gap?'L':'M')+X(p[0]).toFixed(1)+','+Y(p[1]).toFixed(1);
      hits.push({x:X(p[0]),y:Y(p[1]),label:kstShort(p[0])+' · <b>'+fmt(p[1])+'</b>'}); });
    g.push('<path d="'+d+'" fill="none" stroke="var(--mint)" stroke-width="1.8" stroke-linejoin="round"/>');
    if(pts.length<=60) pts.forEach(function(p){ g.push('<circle cx="'+X(p[0])+'" cy="'+Y(p[1])+'" r="2.4" fill="var(--mint)"/>'); });
  }
  var last=hits[hits.length-1];
  g.push('<circle cx="'+last.x+'" cy="'+last.y+'" r="4" fill="var(--ground)" stroke="var(--mint)" stroke-width="2"/>');
  g.push('<line class="dt-cross" x1="0" x2="0" y1="'+T+'" y2="'+(H-B)+'" stroke="var(--text-2)" opacity="0"/>');
  plot.insertAdjacentHTML('afterbegin','<svg viewBox="0 0 '+W+' '+H+'" height="'+H+'" role="img" aria-label="'+esc(item.key)+' 시세 그래프">'+g.join('')+'</svg>');
  /* 손가락/마우스를 올리면 가장 가까운 값 표시 */
  var svg=plot.querySelector('svg'), cross=svg.querySelector('.dt-cross');
  function show(ev){ var r=svg.getBoundingClientRect(), px=(ev.clientX-r.left)*W/r.width, best=null;
    hits.forEach(function(h){ if(!best||Math.abs(h.x-px)<Math.abs(best.x-px)) best=h; });
    if(!best) return; cross.setAttribute('x1',best.x); cross.setAttribute('x2',best.x); cross.setAttribute('opacity','.5');
    tip.innerHTML=best.label; tip.style.display='block';
    var left=best.x*r.width/W; tip.style.left=Math.max(0,Math.min(r.width-tip.offsetWidth,left-tip.offsetWidth/2))+'px'; }
  function hide(){ tip.style.display='none'; cross.setAttribute('opacity','0'); }
  svg.addEventListener('pointermove',show); svg.addEventListener('pointerdown',show); svg.addEventListener('pointerleave',hide);
  /* 요약 숫자 */
  var avg=ys.reduce(function(a,b){return a+b;},0)/ys.length, s=[];
  s.push('기간 평균 <b>'+fmt(avg)+'</b>');
  s.push('최고 <b>'+fmt(Math.max.apply(null,ys))+'</b>');
  s.push('최저 <b>'+fmt(Math.min.apply(null,ys))+'</b>');
  if(item.lo!=null){ var top=item.lo+(item.hi-item.lo)*0.8, n=ys.filter(function(v){return v>=top;}).length;
    s.push('상위 20% 구간('+fmt(Math.ceil(top))+'↑) <b>'+fmt(n/ys.length*100)+'%</b>'); }
  s.push('기록 <b>'+ys.length+'</b>회');
  stats.innerHTML=s.join('');
}

/* ---------- 패널 전체 ---------- */
function mount(el,opt){
  injectCss();
  opt=opt||{};
  var ui={sel:null,days:30,mode:'day'};
  try{ Object.assign(ui,JSON.parse(localStorage.getItem('dongle-prices:ui:'+opt.shop)||'{}')); }catch(e){}
  var saveUi=function(){ try{ localStorage.setItem('dongle-prices:ui:'+opt.shop,JSON.stringify({sel:ui.sel,days:ui.days,mode:ui.mode})); }catch(e){} };
  el.className='dt';
  el.innerHTML='<div class="dt-head"><h3>📈 '+esc(opt.title||'시세 추이')+'</h3><span class="dt-status">시세 불러오는 중…</span></div><div class="dt-body"></div>';
  var items=[], lastInfo=null;

  function render(res){
    var shop=res.data.shops&&res.data.shops[opt.shop];
    var st=el.querySelector('.dt-status'), body=el.querySelector('.dt-body');
    if(!shop||!shop.items.length){ st.innerHTML='<span class="warn">아직 수집된 시세가 없습니다</span>'; body.innerHTML='<p class="dt-empty">수집이 시작되면 여기에 지금 가격과 30일 추이가 뜹니다.</p>'; return; }
    items=summarize(shop);
    if(opt.order) items.sort(function(a,b){ return opt.order.indexOf(a.key)-opt.order.indexOf(b.key); });
    var latest=Math.max.apply(null,items.map(function(i){return i.t||0;}));
    var ageMin=Math.round((Date.now()/1000-latest)/60);
    var stale=ageMin>4*60;   // 갱신 한 번(3시간) + 여유 1시간 넘게 새 값이 없으면 경고
    st.innerHTML='마지막 시세 <b>'+kstShort(latest)+'</b> · '+(ageMin<60?ageMin+'분':Math.floor(ageMin/60)+'시간')+' 전'+
      (stale?' · <span class="warn">수집이 늦어지고 있어요 — 아래 붙여넣기로 직접 넣을 수 있습니다</span>':'')+
      (res.from==='cache'?' · <span class="warn">인터넷 연결 실패, 저장해 둔 값 표시 중</span>':'');
    if(!ui.sel||!items.some(function(i){return i.key===ui.sel;})) ui.sel=(opt.defaultSel&&opt.defaultSel(items))||items[0].key;
    /* 묶음(차수)별 카드 */
    var groups=[], gi={};
    items.forEach(function(it){ var k=it.group||'기타'; if(!(k in gi)){ gi[k]=groups.length; groups.push({name:it.group,lo:it.lo,hi:it.hi,list:[]}); } groups[gi[k]].list.push(it); });
    var showGroupTitles=opt.groupTitles!==false&&groups.length>1&&groups.some(function(g){return g.list.length>1;});
    var h='';
    if(!showGroupTitles) h+='<div class="dt-cards">';
    groups.forEach(function(g){
      if(showGroupTitles) h+='<div class="dt-grp">'+esc(g.name||'기본')+(g.lo!=null?' · '+g.lo+'~'+g.hi:'')+'</div><div class="dt-cards">';
      g.list.forEach(function(it){
        var d=it.prev!=null&&it.price!=null?it.price-it.prev:null;
        var cls=d==null||d===0?'dt-flat':d>0?'dt-up':'dt-down';
        var pos=it.lo!=null&&it.price!=null?Math.max(0,Math.min(100,(it.price-it.lo)/(it.hi-it.lo)*100)):null;
        h+='<button type="button" class="dt-card" data-k="'+esc(it.key)+'" aria-pressed="'+(it.key===ui.sel)+'">'+
          '<div class="dt-name">'+(opt.icon?opt.icon(it)+' ':'')+esc(it.key)+'</div>'+
          '<div class="dt-price">'+fmt(it.price)+'<span class="dt-delta '+cls+'">'+(d==null?'':d>0?'▲'+d:d<0?'▼'+(-d):'–')+'</span></div>'+
          (pos!=null?'<div class="dt-pos" title="범위 안 위치 '+fmt(pos)+'%"><i style="width:'+pos+'%"></i></div>':'<div class="dt-pos" style="visibility:hidden"></div>')+
          spark(it.series,it.lo,it.hi,latest)+'</button>';
      });
      if(showGroupTitles) h+='</div>';
    });
    if(!showGroupTitles) h+='</div>';
    h+='<div class="dt-chartbox"><div class="dt-ctl"><strong class="dt-selname"></strong>'+
      '<span class="dt-seg" data-ctl="days"><button type="button" data-v="7">7일</button><button type="button" data-v="30">30일</button></span>'+
      '<span class="dt-seg" data-ctl="mode"><button type="button" data-v="slot">3시간마다</button><button type="button" data-v="day">하루 단위</button></span>'+
      '</div><div class="dt-plot"><div class="dt-tip"></div></div><div class="dt-stats"></div></div>';
    body.innerHTML=h;
    body.querySelectorAll('.dt-card').forEach(function(b){ b.addEventListener('click',function(){ ui.sel=b.getAttribute('data-k'); saveUi(); paint(); }); });
    body.querySelectorAll('.dt-seg').forEach(function(sg){ var k=sg.getAttribute('data-ctl');
      sg.querySelectorAll('button').forEach(function(b){ b.addEventListener('click',function(){ ui[k]=k==='days'?+b.getAttribute('data-v'):b.getAttribute('data-v'); saveUi(); paint(); }); }); });
    paint();
    lastInfo={items:items,latest:latest,stale:stale,from:res.from};
    if(opt.onData) opt.onData(lastInfo);
  }
  function paint(){
    var body=el.querySelector('.dt-body');
    body.querySelectorAll('.dt-card').forEach(function(b){ b.setAttribute('aria-pressed',String(b.getAttribute('data-k')===ui.sel)); });
    body.querySelectorAll('.dt-seg').forEach(function(sg){ var k=sg.getAttribute('data-ctl');
      sg.querySelectorAll('button').forEach(function(b){ b.setAttribute('aria-pressed',String(String(ui[k])===b.getAttribute('data-v'))); }); });
    var it=items.filter(function(i){return i.key===ui.sel;})[0]; if(!it) return;
    body.querySelector('.dt-selname').textContent=(opt.icon?opt.icon(it)+' ':'')+it.key+(it.lo!=null?' ('+it.lo+'~'+it.hi+')':'');
    drawChart(body.querySelector('.dt-chartbox'),it,ui);
  }
  function refresh(){
    load().then(render).catch(function(){
      el.querySelector('.dt-status').innerHTML='<span class="bad">시세를 불러오지 못했습니다</span> — 인터넷 연결을 확인하거나 아래 붙여넣기를 써 주세요';
      if(opt.onData) opt.onData(null);
    });
  }
  refresh();
  /* 10분마다 새 시세 확인, 화면 크기가 바뀌면 그래프 다시 그림 */
  setInterval(refresh,10*60*1000);
  var rt=null; window.addEventListener('resize',function(){ clearTimeout(rt); rt=setTimeout(function(){ if(items.length) paint(); },150); });
  return {refresh:refresh,info:function(){return lastInfo;}};
}

window.DongleTracker={mount:mount,DATA_URL:DATA_URL,timeLabel:kstShort};
})();
