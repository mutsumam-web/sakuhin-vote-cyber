const MAX_VOTES=3;
const STORAGE_KEY="sakuhin_vote_done_v15";
const VOTE_TREND_REFRESH_MS=60000;
const API_BASE=(window.__SAKUHIN_API_BASE__||'https://sakuhin-vote-api.mutsumam.workers.dev').replace(/\/$/,'');

async function rpcCall(method){
  const args=[].slice.call(arguments,1);
  const response=await fetch(API_BASE+'/api/rpc',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({method:method,args:args})
  });

  let payload=null;
  try{payload=await response.json();}catch(e){}

  if(!response.ok||!payload||payload.ok!==true){
    const code=payload&&payload.error?payload.error:'HTTP_'+response.status;
    throw new Error(code);
  }

  return payload.result;
}

let works=[];
let selected=[];

function setCookie(name,value,days){
  const date=new Date();
  date.setTime(date.getTime()+days*86400000);
  document.cookie=name+'='+encodeURIComponent(value)+';expires='+date.toUTCString()+';path=/;SameSite=Lax';
}

function getCookie(name){
  const item=document.cookie.split('; ').find(value=>value.startsWith(name+'='));
  return item?decodeURIComponent(item.split('=').slice(1).join('=')):'';
}

function hasVoted(){
  return localStorage.getItem(STORAGE_KEY)==='1'||getCookie('sakuhin_vote_done')==='1';
}

function markVoted(){
  localStorage.setItem(STORAGE_KEY,'1');
  setCookie('sakuhin_vote_done','1',3650);
}

function showVotedMask(){
  const mask=document.getElementById('votedMask');
  if(!mask)return;
  mask.hidden=false;
  mask.setAttribute('aria-hidden','false');
  document.body.classList.add('voted-mask-active');
}

function hideVotedMask(){
  const mask=document.getElementById('votedMask');
  if(!mask)return;
  mask.hidden=true;
  mask.setAttribute('aria-hidden','true');
  document.body.classList.remove('voted-mask-active');
}

function init(){
  document.getElementById('voteButton').addEventListener('click',submitVote);
  document.getElementById('adminButton').addEventListener('click',showAdmin);

  const votedMaskAdminZone=document.querySelector('.voted-mask-admin-zone');
  if(votedMaskAdminZone){
    votedMaskAdminZone.addEventListener('click',showAdmin);
    votedMaskAdminZone.addEventListener('keydown',function(event){
      if(event.key==='Enter'||event.key===' '){
        event.preventDefault();
        showAdmin();
      }
    });
  }

  loadWorks();
  loadVoteTrend();
  setInterval(loadVoteTrend,VOTE_TREND_REFRESH_MS);
  if(hasVoted()){
    showVotedMask();
  }else{
    hideVotedMask();
  }
}

function loadVoteTrend(){
  const status=document.getElementById('voteTrendStatus');
  if(!status)return;

  status.textContent='SYNC ACTIVE';

  rpcCall('getVoteIntervalData')
    .then(function(data){
      const rows=Array.isArray(data)?data:[];
      renderVoteTrend(rows);
      const total=document.getElementById('voteTrendTotal');
      if(total){
        const totalVotes=rows.reduce(function(sum,item){
          return sum+Math.max(0,Number(item.count)||0);
        },0);
        total.textContent='TOTAL '+totalVotes;
      }
      status.textContent='LIVE / '+new Date().toLocaleTimeString('ja-JP',{
        hour:'2-digit',
        minute:'2-digit'
      });
    })
    .catch(function(error){
      status.textContent='DATA ERROR';
      renderVoteTrendError();
      console.error(error);
    });
}

function renderVoteTrend(data){
  const svg=document.getElementById('voteTrendChart');
  if(!svg)return;

  while(svg.firstChild)svg.removeChild(svg.firstChild);

  if(!data.length){
    renderVoteTrendError('投票データなし');
    return;
  }

  const width=1000;
  const height=140;
  const left=104;
  const right=20;
  const top=18;
  const bottom=34;
  const chartWidth=width-left-right;
  const chartHeight=height-top-bottom;

  svg.setAttribute('viewBox','0 0 '+width+' '+height);
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');

  const values=data.map(function(item){return Number(item.count)||0;});
  const maxValue=Math.max.apply(null,values.concat([4]));
  const yMax=Math.max(4,Math.ceil(maxValue/2)*2);

  function el(tag,attrs){
    const node=document.createElementNS('http://www.w3.org/2000/svg',tag);
    Object.keys(attrs||{}).forEach(function(key){
      node.setAttribute(key,attrs[key]);
    });
    return node;
  }

  function xFor(index){
    if(data.length<=1)return left+chartWidth/2;
    return left+(index/(data.length-1))*chartWidth;
  }

  function yFor(value){
    return top+chartHeight-(value/yMax)*chartHeight;
  }

  // Axis labels are sized in SVG user-units as a proportion of the
  // SVG coordinate width. No CSS vmin and no viewport->SVG conversion.
  // This keeps the text on the same scale as the graph itself.
  const axisFontSize=width*0.012;
  const xAxisFontSize=width*0.012;

  for(let value=0;value<=yMax;value+=2){
    const y=yFor(value);

    svg.appendChild(el('line',{
      x1:left,x2:width-right,y1:y,y2:y,
      class:'trend-grid'
    }));

    const label=el('text',{
      x:left-10,
      y:y+axisFontSize*0.35,
      'text-anchor':'end',
      class:'trend-y-label',
      'font-size':axisFontSize,
      'font-family':'Montserrat, "Noto Sans JP", sans-serif',
      'font-weight':'700',
      'letter-spacing':'0',
      'fill':'#79f6ff'
    });
    label.textContent=String(value);
    svg.appendChild(label);
  }

  data.forEach(function(item,index){
    const x=xFor(index);

    svg.appendChild(el('line',{
      x1:x,x2:x,y1:top,y2:height-bottom,
      class:'trend-tick'
    }));

    const label=el('text',{
      x:x,
      y:height-3,
      'text-anchor':'middle',
      class:'trend-x-label',
      'font-size':xAxisFontSize,
      'font-family':'Montserrat, "Noto Sans JP", sans-serif',
      'font-weight':'700',
      'letter-spacing':'0',
      'fill':'#79f6ff'
    });
    label.textContent=new Date(item.timestamp).toLocaleTimeString('ja-JP',{
      hour:'2-digit',
      minute:'2-digit'
    });
    svg.appendChild(label);
  });

  const points=data.map(function(item,index){
    return xFor(index)+','+yFor(Number(item.count)||0);
  }).join(' ');

  svg.appendChild(el('polyline',{
    points:points,
    class:'trend-line'
  }));
}

function renderVoteTrendError(message){
  const svg=document.getElementById('voteTrendChart');
  if(!svg)return;

  while(svg.firstChild)svg.removeChild(svg.firstChild);

  svg.setAttribute('viewBox','0 0 1000 140');
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');

  const text=document.createElementNS('http://www.w3.org/2000/svg','text');
  text.setAttribute('x','500');
  text.setAttribute('y','62');
  text.setAttribute('text-anchor','middle');
  text.setAttribute('class','trend-empty');
  text.textContent=message||'投票データを取得できませんでした';
  svg.appendChild(text);
}

function loadWorks(){
  rpcCall('getChoiceOptions')
    .then(function(data){
      works=Array.isArray(data)?data:[];
      renderWorks();
    })
    .catch(function(error){
      document.getElementById('works').textContent='作品データを取得できませんでした。';
      console.error(error);
    });
}

function parseChoiceInfo(value){
  const work=works.find(function(item){
    return item&&item.value===value;
  });

  if(work&&(work.title||work.author||work.comment)){
    return{
      title:String(work.title||'').trim(),
      author:String(work.author||'').trim(),
      comment:String(work.comment||'').trim()
    };
  }

  const raw=String(value==null?'':value).trim();
  if(!raw)return{title:'',author:'',comment:''};

  const firstSpace=raw.indexOf(' ');
  if(firstSpace===-1)return{title:raw,author:'',comment:''};

  const title=raw.slice(0,firstSpace).trim();
  const rest=raw.slice(firstSpace+1).trim();
  const secondSpace=rest.indexOf(' ');

  if(secondSpace===-1)return{title:raw,author:'',comment:''};

  const author=rest.slice(0,secondSpace).trim();
  const comment=rest.slice(secondSpace+1).trim();

  return{title,author,comment};
}

function updateSignalDisplay(signalMeter,scanLabel,crtSignal,value,state){
  signalMeter.textContent='SIGNAL '+Math.max(0,Math.min(100,Math.round(value)))+'%';
  if(state==='loading'){
    scanLabel.textContent='SYNC ACTIVE';
    crtSignal.textContent='◐ LINKING';
  }else if(state==='loaded'){
    scanLabel.textContent='SCAN COMPLETE';
    crtSignal.textContent='● ONLINE';
  }else if(state==='error'){
    scanLabel.textContent='SIGNAL ERROR';
    crtSignal.textContent='○ OFFLINE';
  }
}

function attachImageSignal(image,imageWrap,signalMeter,scanLabel,crtSignal){
  let finished=false;

  const finish=function(){
    if(finished)return;
    finished=true;
    clearTimeout(step1);
    clearTimeout(step2);
    clearTimeout(step3);
    updateSignalDisplay(signalMeter,scanLabel,crtSignal,100,'loaded');
    imageWrap.classList.remove('signal-loading');
    imageWrap.classList.add('signal-loaded');

    const beam=document.createElement('div');
    beam.className='scan-beam';
    imageWrap.appendChild(beam);

    requestAnimationFrame(function(){beam.classList.add('run');});
    setTimeout(function(){beam.remove();},900);
  };

  const fail=function(){
    if(finished)return;
    finished=true;
    clearTimeout(step1);
    clearTimeout(step2);
    clearTimeout(step3);
    updateSignalDisplay(signalMeter,scanLabel,crtSignal,0,'error');
    imageWrap.classList.remove('signal-loading');
    imageWrap.classList.add('signal-error');
  };

  imageWrap.classList.add('signal-loading');
  updateSignalDisplay(signalMeter,scanLabel,crtSignal,8,'loading');

  const step1=setTimeout(function(){
    if(!finished)updateSignalDisplay(signalMeter,scanLabel,crtSignal,32,'loading');
  },120);

  const step2=setTimeout(function(){
    if(!finished)updateSignalDisplay(signalMeter,scanLabel,crtSignal,61,'loading');
  },320);

  const step3=setTimeout(function(){
    if(!finished)updateSignalDisplay(signalMeter,scanLabel,crtSignal,86,'loading');
  },650);

  image.addEventListener('load',finish,{once:true});
  image.addEventListener('error',fail,{once:true});

  if(image.complete){
    if(image.naturalWidth>0)finish();
    else fail();
  }
}

function triggerSelectionPulse(value){
  const index=works.findIndex(function(work){return work.value===value;});
  if(index<0)return;

  const cards=document.querySelectorAll('.work-card');
  const card=cards[index];
  if(!card)return;

  card.classList.remove('selection-pulse');
  void card.offsetWidth;
  card.classList.add('selection-pulse');

  setTimeout(function(){card.classList.remove('selection-pulse');},700);
}


function showMaxVoteError(){
  const panel=document.getElementById('maxVoteErrorPanel');
  if(!panel)return;

  panel.classList.remove('show');
  panel.setAttribute('aria-hidden','false');
  panel.style.visibility='visible';
  panel.style.opacity='1';
  panel.style.transform='translate(-50%,-50%) scale(1)';
  void panel.offsetWidth;
  panel.classList.add('show');

  clearTimeout(window.maxVoteErrorTimer);
  window.maxVoteErrorTimer=setTimeout(function(){
    panel.classList.remove('show');
    panel.style.opacity='0';
    panel.style.visibility='hidden';
    panel.setAttribute('aria-hidden','true');
  },1100);
}

function flashMaxVoteRegions(){
  showMaxVoteError();
  const regions=[];
  document.querySelectorAll('.app-header, .vote-trend, .selection-console, .works-list, .work-card').forEach(function(el){
    if(el.offsetWidth>0 && el.offsetHeight>0) regions.push(el);
  });

  regions.forEach(function(el,index){
    el.classList.remove('max-vote-red-flash');
    el.style.animationDelay='';
    void el.offsetWidth;
    el.style.animationDelay=(index*45)+'ms';
    el.classList.add('max-vote-red-flash');
  });

  clearTimeout(window.maxVoteRegionFlashTimer);
  window.maxVoteRegionFlashTimer=setTimeout(function(){
    regions.forEach(function(el){
      el.classList.remove('max-vote-red-flash');
      el.style.animationDelay='';
    });
  },1100);
}

function triggerUnlockEffect(value){
  const index=works.findIndex(function(work){return work.value===value;});
  if(index<0)return;

  const cards=document.querySelectorAll('.work-card');
  const card=cards[index];
  if(!card)return;

  const button=card.querySelector('.select-btn');
  if(!button)return;

  // LOCK → SELECT は、再描画直後でも確実に発火させる
  card.classList.remove('unlock-return');
  button.classList.remove('unlocking');
  void card.offsetWidth;
  void button.offsetWidth;

  card.classList.add('unlock-return');
  button.classList.add('unlocking');

  setTimeout(function(){
    card.classList.remove('unlock-return');
    button.classList.remove('unlocking');
  },760);
}

function renderWorks(revealValue){
  const container=document.getElementById('works');
  container.innerHTML='';

  works.forEach(function(work,index){
    const wrapper=document.createElement('div');
    wrapper.className='work-card'+(selected.includes(work.value)?' selected':'');
    wrapper.dataset.workIndex=String(index);
    wrapper.dataset.workValue=work.value;

    const number=document.createElement('div');
    number.className='work-number';
    number.textContent=String(index+1).padStart(2,'0');

    const numberStatus=document.createElement('div');
    numberStatus.className='number-status';
    numberStatus.innerHTML='<span class="number-status-label">VOTE</span><span class="number-status-value">READY</span>';
    number.appendChild(numberStatus);

    const imageWrap=document.createElement('div');
    imageWrap.className='work-image-wrap';

    const parsed=parseChoiceInfo(work.value);
    let image=null;

    if(work.image){
      image=document.createElement('img');
      image.className='work-image';
      image.src=work.image;
      image.alt=parsed.title;
      imageWrap.appendChild(image);
    }

    const imageHud=document.createElement('div');
    imageHud.className='image-hud';

    const targetLabel=document.createElement('div');
    targetLabel.className='target-label';
    targetLabel.textContent='TARGET '+String(index+1).padStart(2,'0');

    const signalMeter=document.createElement('div');
    signalMeter.className='signal-meter';
    signalMeter.textContent='SIGNAL 08%';

    const scanLabel=document.createElement('div');
    scanLabel.className='scan-label';
    scanLabel.textContent='SYNC ACTIVE';

    imageHud.appendChild(targetLabel);
    imageHud.appendChild(signalMeter);
    imageHud.appendChild(scanLabel);
    imageWrap.appendChild(imageHud);

    const crtLabel=document.createElement('div');
    crtLabel.className='crt-label';
    crtLabel.textContent='CRT // SIGNAL '+String(index+1).padStart(2,'0');

    const crtSignal=document.createElement('div');
    crtSignal.className='crt-signal';
    crtSignal.textContent='◐ LINKING';

    imageWrap.appendChild(crtLabel);
    imageWrap.appendChild(crtSignal);

    if(work.image){
      attachImageSignal(image,imageWrap,signalMeter,scanLabel,crtSignal);
    }else{
      updateSignalDisplay(signalMeter,scanLabel,crtSignal,0,'error');
    }

    const calloutSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    calloutSvg.classList.add('callout-svg');
    calloutSvg.setAttribute('aria-hidden','true');
    wrapper.appendChild(calloutSvg);

    const info=document.createElement('div');
    info.className='work-info';

    const infoTop=document.createElement('div');
    infoTop.className='work-info-top';
    infoTop.innerHTML='<span>ARTWORK // '+String(index+1).padStart(3,'0')+'</span><span class="work-status">● ONLINE</span>';

    const titleBlock=document.createElement('div');
    titleBlock.className='data-block callout-box work-title-block';
    titleBlock.dataset.callout='title';

    const titleLabel=document.createElement('span');
    titleLabel.className='data-label';
    titleLabel.textContent='TARGET NAME';

    const title=document.createElement('div');
    title.className='work-title';
    title.textContent=parsed.title;

    titleBlock.appendChild(titleLabel);
    titleBlock.appendChild(title);

    const authorBlock=document.createElement('div');
    authorBlock.className='data-block callout-box work-author-block';
    authorBlock.dataset.callout='author';

    const authorLabel=document.createElement('span');
    authorLabel.className='work-author-label';
    authorLabel.textContent='CREATOR ID';

    const author=document.createElement('div');
    author.className='work-author';
    author.textContent=parsed.author;

    authorBlock.appendChild(authorLabel);
    authorBlock.appendChild(author);

    const commentBlock=document.createElement('div');
    commentBlock.className='data-block callout-box work-comment-block';
    commentBlock.dataset.callout='comment';

    const commentLabel=document.createElement('span');
    commentLabel.className='work-comment-label';
    commentLabel.textContent='DATA STREAM';

    const comment=document.createElement('div');
    comment.className='work-comment is-collapsed';
    comment.textContent=parsed.comment;

    commentBlock.appendChild(commentLabel);
    commentBlock.appendChild(comment);

    const actions=document.createElement('div');
    actions.className='work-actions';

    const detail=document.createElement('button');
    detail.className='detail-btn';
    detail.textContent='DETAIL';
    detail.onclick=function(){toggleDetail(commentBlock,detail,wrapper);};

    const button=document.createElement('button');
    button.className='select-btn'+(selected.includes(work.value)?' selected':'');
    button.textContent=selected.includes(work.value)?'LOCKED':'SELECT';
    button.onclick=function(){toggleSelection(work.value);};

    actions.appendChild(detail);
    actions.appendChild(button);

    info.appendChild(infoTop);
    info.appendChild(titleBlock);
    info.appendChild(authorBlock);

    // 4カラム構造を維持し、ACTIONは右カラム、
    // コメントはその下で情報欄から右カラムまで横断させる。
    wrapper.appendChild(number);
    wrapper.appendChild(imageWrap);
    wrapper.appendChild(info);
    wrapper.appendChild(actions);
    wrapper.appendChild(commentBlock);
    container.appendChild(wrapper);
  });

  updateUI();
  requestAnimationFrame(function(){drawAllCallouts(revealValue);});
}

let calloutResizeTimer=null;

function drawAllCallouts(revealValue){
  const cards=document.querySelectorAll('.work-card');

  // ターゲット位置を先に決定し、折れ部は必ずターゲットより右側に置く。
  // b は直接指定せず、target.x から一定の余白を取って算出する。
  const layouts=[
    {x:24,y:27},
    {x:36,y:23},
    {x:42,y:34},
    {x:32,y:31},
    {x:30,y:24}
  ];

  cards.forEach(function(card,index){
    const svg=card.querySelector('.callout-svg');
    const imageWrap=card.querySelector('.work-image-wrap');
    const source=card.querySelector('.work-title-block');
    if(!svg||!imageWrap||!source)return;

    const cardRect=card.getBoundingClientRect();
    const imageRect=imageWrap.getBoundingClientRect();
    const sourceRect=source.getBoundingClientRect();
    const width=cardRect.width;
    const height=cardRect.height;

    svg.setAttribute('viewBox','0 0 '+width+' '+height);
    svg.setAttribute('width',width);
    svg.setAttribute('height',height);

    while(svg.firstChild)svg.removeChild(svg.firstChild);

    const target=layouts[index%layouts.length];
    const sx=sourceRect.left-cardRect.left;
    const sy=sourceRect.top-cardRect.top+sourceRect.height*0.55;
    const tx=imageRect.left-cardRect.left+imageRect.width*target.x/100;
    const ty=imageRect.top-cardRect.top+imageRect.height*target.y/100;

    // ターゲットより右側に折れ部を置く。
    // ただし折れ部は情報欄側へ出過ぎないよう、画像右端手前で止める。
    const targetGap=imageRect.width*0.22;
    const maxBendX=imageRect.left-cardRect.left+imageRect.width*0.86;
    const bendX=Math.min(tx+targetGap,maxBendX);

    const line=document.createElementNS('http://www.w3.org/2000/svg','path');
    line.setAttribute('d','M '+sx+' '+sy+' H '+bendX+' L '+tx+' '+ty);
    line.classList.add('callout-path');
    svg.appendChild(line);

    // 選択済みの線は全て表示状態を維持。
    // ただし今回SELECTした作品だけを出現アニメーションさせる。
    // これにより2個目・3個目を選択した際、以前の線は再描画されない。
    let lineLength=0;
    if(card.classList.contains('selected')){
      try{
        lineLength=line.getTotalLength();
        line.style.setProperty('--callout-length',String(lineLength));
        line.style.strokeDasharray=String(lineLength);
        line.style.strokeDashoffset='0';
      }catch(e){}
    }

    const targetDot=document.createElementNS('http://www.w3.org/2000/svg','circle');
    targetDot.setAttribute('cx',tx);
    targetDot.setAttribute('cy',ty);
    targetDot.setAttribute('r',4.2);
    targetDot.classList.add('callout-target');
    svg.appendChild(targetDot);

    const core=document.createElementNS('http://www.w3.org/2000/svg','circle');
    core.setAttribute('cx',tx);
    core.setAttribute('cy',ty);
    core.setAttribute('r',1.8);
    core.classList.add('callout-target-core');
    svg.appendChild(core);

    if(card.classList.contains('selected') && revealValue===card.dataset.workValue){
      line.style.strokeDashoffset=String(lineLength);
      line.classList.add('callout-reveal-path');
      targetDot.classList.add('callout-reveal-target');
      core.classList.add('callout-reveal-target');
    }
  });
}

function scheduleCalloutRedraw(){
  clearTimeout(calloutResizeTimer);
  calloutResizeTimer=setTimeout(function(){drawAllCallouts();},80);
}

window.addEventListener('resize',scheduleCalloutRedraw);

function redrawSingleCallout(card,reveal){
  const svg=card&&card.querySelector('.callout-svg');
  const imageWrap=card&&card.querySelector('.work-image-wrap');
  const source=card&&card.querySelector('.work-title-block');
  if(!svg||!imageWrap||!source)return;

  const index=Number(card.dataset.workIndex)||0;
  const layouts=[
    {x:24,y:27},
    {x:36,y:23},
    {x:42,y:34},
    {x:32,y:31},
    {x:30,y:24}
  ];

  const cardRect=card.getBoundingClientRect();
  const imageRect=imageWrap.getBoundingClientRect();
  const sourceRect=source.getBoundingClientRect();
  const width=cardRect.width;
  const height=cardRect.height;

  svg.setAttribute('viewBox','0 0 '+width+' '+height);
  svg.setAttribute('width',width);
  svg.setAttribute('height',height);
  while(svg.firstChild)svg.removeChild(svg.firstChild);

  const target=layouts[index%layouts.length];
  const sx=sourceRect.left-cardRect.left;
  const sy=sourceRect.top-cardRect.top+sourceRect.height*0.55;
  const tx=imageRect.left-cardRect.left+imageRect.width*target.x/100;
  const ty=imageRect.top-cardRect.top+imageRect.height*target.y/100;
  const targetGap=imageRect.width*0.22;
  const maxBendX=imageRect.left-cardRect.left+imageRect.width*0.86;
  const bendX=Math.min(tx+targetGap,maxBendX);

  const line=document.createElementNS('http://www.w3.org/2000/svg','path');
  line.setAttribute('d','M '+sx+' '+sy+' H '+bendX+' L '+tx+' '+ty);
  line.classList.add('callout-path');
  svg.appendChild(line);

  let lineLength=0;
  try{
    lineLength=line.getTotalLength();
    line.style.setProperty('--callout-length',String(lineLength));
    line.style.strokeDasharray=String(lineLength);
    line.style.strokeDashoffset=reveal?String(lineLength):'0';
  }catch(e){}

  const targetDot=document.createElementNS('http://www.w3.org/2000/svg','circle');
  targetDot.setAttribute('cx',tx);
  targetDot.setAttribute('cy',ty);
  targetDot.setAttribute('r',4.2);
  targetDot.classList.add('callout-target');
  svg.appendChild(targetDot);

  const core=document.createElementNS('http://www.w3.org/2000/svg','circle');
  core.setAttribute('cx',tx);
  core.setAttribute('cy',ty);
  core.setAttribute('r',1.8);
  core.classList.add('callout-target-core');
  svg.appendChild(core);

  if(reveal){
    line.classList.add('callout-reveal-path');
    targetDot.classList.add('callout-reveal-target');
    core.classList.add('callout-reveal-target');
  }
}

function toggleSelection(value){
  if(hasVoted())return;

  const index=selected.indexOf(value);
  const wasSelected=index>=0;

  if(wasSelected){
    selected.splice(index,1);
  }else{
    if(selected.length>=MAX_VOTES){
      flashMaxVoteRegions();
      return;
    }
    selected.push(value);
  }

  if(document.activeElement && typeof document.activeElement.blur==='function'){
    document.activeElement.blur();
  }

  // 選択操作ではカード全体を再描画しない。
  // 既に選択済みのカードの引き出し線・画像・表示状態をそのまま維持する。
  const card=document.querySelector('.work-card[data-work-value="'+CSS.escape(value)+'"]');
  if(card){
    const button=card.querySelector('.select-btn');

    if(wasSelected){
      card.classList.remove('selected');
      if(button){
        button.classList.remove('selected');
        button.textContent='SELECT';
        button.blur();
      }
      const svg=card.querySelector('.callout-svg');
      if(svg){
        svg.style.opacity='0';
        svg.style.visibility='hidden';
      }
    }else{
      card.classList.add('selected');
      if(button){
        button.classList.add('selected');
        button.textContent='LOCKED';
      }
      const svg=card.querySelector('.callout-svg');
      if(svg){
        svg.style.opacity='1';
        svg.style.visibility='visible';
      }
      redrawSingleCallout(card,true);
    }
  }

  updateUI();

  if(!wasSelected){
    triggerSelectionPulse(value);
  }
}
function updateUI(){
  document.getElementById('count').textContent=selected.length;

  const selectedElement=document.getElementById('selected');

  if(!selected.length){
    selectedElement.textContent='選択作品なし';
  }else{
    selectedElement.textContent=selected.map(function(value){
      return parseChoiceInfo(value).title;
    }).join(' / ');
  }

  document.getElementById('voteButton').disabled=selected.length===0;

  const dots=document.querySelectorAll('.capacity-dot');
  dots.forEach(function(dot,index){
    dot.classList.toggle('active',index<selected.length);
  });
}

function toggleDetail(commentBlock,button,card){
  const comment=commentBlock.querySelector('.work-comment');
  // コメントがないカードはDETAIL操作を一切行わない。
  if(!comment || !comment.textContent.trim()) return;
  const expanded=!comment.classList.contains('is-expanded');
  comment.classList.toggle('is-expanded',expanded);
  comment.classList.toggle('is-collapsed',!expanded);
  card.classList.toggle('detail-open',expanded);
  button.textContent=expanded?'HIDE':'DETAIL';
  button.classList.toggle('is-open',expanded);
  requestAnimationFrame(drawAllCallouts);
}

function submitVote(){
  if(selected.length<1||selected.length>MAX_VOTES)return;

  const button=document.getElementById('voteButton');
  if(!button||button.disabled)return;

  button.disabled=true;
  button.textContent='送信中…';

  rpcCall('submitVoteToForm',selected.slice())
    .then(function(ok){
      if(!ok){
        button.disabled=false;
        button.textContent='投票する';
        alert('投票に失敗しました。');
        return;
      }

      markVoted();
      selected=[];
      updateUI();
      button.textContent='投票する';
      button.disabled=true;
      showVotedMask();
    })
    .catch(function(error){
      button.disabled=false;
      button.textContent='投票する';
      alert('投票に失敗しました。\n'+error.message);
    });
}

function showAdmin(){
  const code=window.prompt('管理者コードを入力してください。');

  if(code===null)return;

  adminReset(code.trim());
}

function adminReset(code){
  rpcCall('adminReset',code)
    .then(function(ok){
      if(!ok){
        alert('管理コードが違います。');
        return;
      }

      localStorage.removeItem(STORAGE_KEY);

      document.cookie='sakuhin_vote_done=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';

      selected=[];

      hideVotedMask();
      renderWorks();
      updateUI();
    })
    .catch(function(){
      alert('管理コードの確認に失敗しました。');
    });
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init,{once:true});
}else{
  init();
}

/* Chrome pinch-zoom position recovery: restore the pre-zoom document position once, only when returning to 1x. */
(function(){
  const vv = window.visualViewport;
  if(!vv) return;

  let zooming = false;
  let savedScrollY = 0;
  let restorePending = false;
  let restoreTimer = null;

  function onViewportResize(){
    const scale = vv.scale || 1;

    if(scale > 1.02 && !zooming){
      zooming = true;
      savedScrollY = window.scrollY || window.pageYOffset || 0;
      restorePending = false;
      if(restoreTimer){
        clearTimeout(restoreTimer);
        restoreTimer = null;
      }
      return;
    }

    if(zooming && scale <= 1.02 && !restorePending){
      restorePending = true;
      restoreTimer = setTimeout(function(){
        window.scrollTo(0, savedScrollY);
        requestAnimationFrame(function(){
          window.scrollTo(0, savedScrollY);
          zooming = false;
          restorePending = false;
          restoreTimer = null;
        });
      }, 80);
    }
  }

  vv.addEventListener('resize', onViewportResize, {passive:true});
})();
