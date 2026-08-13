(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const STEPS = 16;

  const padDefs = [
    ['Kick 1','kick','ROUND'],['Kick 2','kick2','PUNCH'],['Snare 1','snare','CRACK'],['Snare 2','snare2','DRY'],
    ['Clap','clap','WIDE'],['Rim','rim','CLICK'],['Closed Hat','hat','TIGHT'],['Open Hat','openhat','LOOSE'],
    ['808/Sub','sub','LOW'],['Low Tom','tom','BODY'],['Tamb','tamb','SHAKE'],['Perc','perc','FUNK'],
    ['Crash','crash','AIR'],['FX Zap','zap','G-FUNK'],['Scratch FX','scratch','CUT'],['Vocal Chop','vocal','HEY']
  ];

  let ctx, master, mediaDest, recorder, recordingChunks=[];
  let audioReady=false, isPlaying=false, currentStep=0, currentBar=0, nextNoteTime=0, timerId=null;
  let trackBuffer=null, trackSource=null, trackGain=null, trackStartedAt=0, trackOffset=0;
  let tapTimes=[], selectedPad=0, lessonIndex=0;
  let importedBuffers = Array(padDefs.length).fill(null);
  let padSettings = padDefs.map(() => ({volume:1,pitch:0}));
  let pattern = padDefs.map(() => Array(STEPS).fill(false));

  const lessonSteps = [
    { text:'Put the snare on beats 2 and 4. The highlighted steps show you exactly where.', targets:[[2,4],[2,12]] },
    { text:'Now add the backbone kick. Keep it simple before getting fancy.', targets:[[0,0],[0,8],[0,11]] },
    { text:'Add closed hats on the eighth notes. This gives the groove motion.', targets:[[6,0],[6,2],[6,4],[6,6],[6,8],[6,10],[6,12],[6,14]] },
    { text:'Add a little extra kick before beat 4. Then adjust Swing and listen to the pocket change.', targets:[[0,10]] }
  ];

  function initAudio(){
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) throw new Error('Web Audio is not supported on this browser.');
    try { ctx = new AC({latencyHint:'interactive'}); } catch { ctx = new AC(); }
    master = ctx.createGain();
    master.gain.value = 0.85;
    mediaDest = ctx.createMediaStreamDestination();
    master.connect(ctx.destination);
    master.connect(mediaDest);
    trackGain = ctx.createGain();
    trackGain.gain.value = 0.7;
    trackGain.connect(master);
    audioReady = true;
    if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }

  async function ensureAudio(){
    if(!audioReady) initAudio();
    if(ctx.state === 'suspended' || ctx.state === 'interrupted') {
      try { await ctx.resume(); } catch {}
    }
    // iOS Safari sometimes needs an actual audio node started inside the user gesture
    // before it fully unlocks the hardware output.
    if(!ensureAudio._unlocked){
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.connect(ctx.destination);
        src.start(0);
        ensureAudio._unlocked = true;
      } catch {}
    }
    return ctx.state;
  }

  function noiseBuffer(duration=.2){
    const length = Math.max(1, Math.floor(ctx.sampleRate*duration));
    const b = ctx.createBuffer(1,length,ctx.sampleRate);
    const d = b.getChannelData(0);
    for(let i=0;i<length;i++) d[i]=Math.random()*2-1;
    return b;
  }

  function destinationGain(index, when, duration=.5){
    const g = ctx.createGain();
    const vol = padSettings[index].volume;
    g.gain.setValueAtTime(Math.max(0.0001,vol), when);
    g.connect(master);
    return g;
  }

  function playImported(index, when){
    const b = importedBuffers[index]; if(!b) return false;
    const src=ctx.createBufferSource(), g=destinationGain(index,when,b.duration);
    src.buffer=b;
    src.playbackRate.setValueAtTime(Math.pow(2,padSettings[index].pitch/12),when);
    src.connect(g); src.start(when); return true;
  }

  function osc(index, when, type, f1, f2, dur, level=1){
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(f1,when); o.frequency.exponentialRampToValueAtTime(Math.max(20,f2),when+dur);
    const v=Math.max(.0001,padSettings[index].volume*level);
    g.gain.setValueAtTime(v,when); g.gain.exponentialRampToValueAtTime(.0001,when+dur);
    o.connect(g); g.connect(master); o.start(when); o.stop(when+dur+.02);
  }

  function noise(index, when, dur, level=.4, hp=0, bp=0){
    const src=ctx.createBufferSource(), g=ctx.createGain(); src.buffer=noiseBuffer(dur+.02);
    let node=src;
    if(hp){const f=ctx.createBiquadFilter();f.type='highpass';f.frequency.value=hp;node.connect(f);node=f;}
    if(bp){const f=ctx.createBiquadFilter();f.type='bandpass';f.frequency.value=bp;f.Q.value=.8;node.connect(f);node=f;}
    const v=Math.max(.0001,padSettings[index].volume*level);
    g.gain.setValueAtTime(v,when); g.gain.exponentialRampToValueAtTime(.0001,when+dur);
    node.connect(g);g.connect(master);src.start(when);src.stop(when+dur+.03);
  }

  function triggerPad(index, when=ctx.currentTime){
    if(!audioReady) return;
    if(playImported(index,when)) return flashPad(index);
    const pitch=Math.pow(2,padSettings[index].pitch/12);
    switch(padDefs[index][1]){
      case 'kick': osc(index,when,'sine',150*pitch,48*pitch,.42,1.05); break;
      case 'kick2': osc(index,when,'triangle',180*pitch,54*pitch,.25,.95); noise(index,when,.045,.12,500); break;
      case 'snare': noise(index,when,.18,.7,1200); osc(index,when,'triangle',190*pitch,145*pitch,.11,.28); break;
      case 'snare2': noise(index,when,.12,.65,1700); osc(index,when,'triangle',235*pitch,190*pitch,.08,.2); break;
      case 'clap': [0,.017,.034].forEach(t=>noise(index,when+t,.08,.34,900)); break;
      case 'rim': osc(index,when,'square',960*pitch,700*pitch,.045,.28); break;
      case 'hat': noise(index,when,.055,.28,6500); break;
      case 'openhat': noise(index,when,.32,.22,6200); break;
      case 'sub': osc(index,when,'sine',68*pitch,43*pitch,.8,.9); break;
      case 'tom': osc(index,when,'sine',150*pitch,85*pitch,.28,.55); break;
      case 'tamb': [0,.035,.07].forEach(t=>noise(index,when+t,.06,.16,4800)); break;
      case 'perc': osc(index,when,'triangle',420*pitch,240*pitch,.09,.35); break;
      case 'crash': noise(index,when,.95,.18,3500); break;
      case 'zap': osc(index,when,'sawtooth',1100*pitch,120*pitch,.3,.2); break;
      case 'scratch': noise(index,when,.16,.28,1200,1900); break;
      case 'vocal': osc(index,when,'square',330*pitch,220*pitch,.18,.16); break;
    }
    flashPad(index);
  }

  function flashPad(index){
    const el=$(`.pad[data-index="${index}"]`); if(!el) return;
    el.classList.add('active'); setTimeout(()=>el.classList.remove('active'),80);
  }

  function scheduler(){
    if(!isPlaying) return;
    const scheduleAhead=.1;
    while(nextNoteTime < ctx.currentTime + scheduleAhead){
      scheduleStep(currentStep,nextNoteTime);
      advanceStep();
    }
    timerId=setTimeout(scheduler,25);
  }

  function scheduleStep(step, when){
    pattern.forEach((row,i)=>{ if(row[step]) triggerPad(i,when); });
    const delay=Math.max(0,(when-ctx.currentTime)*1000);
    setTimeout(()=>paintCurrentStep(step),delay);
  }

  function advanceStep(){
    const bpm=clamp(Number($('#bpm').value)||94,50,200);
    const base=60/bpm/4;
    const swing=clamp(Number($('#swing').value)||0,0,60)/100;
    const swingOffset = currentStep%2===0 ? base*swing*.45 : -base*swing*.45;
    nextNoteTime += base + swingOffset;
    currentStep++;
    if(currentStep>=STEPS){
      currentStep=0;
      currentBar=(currentBar+1)%clamp(Number($('#bars').value)||1,1,8);
    }
  }

  async function startSeq(){
    await ensureAudio(); if(isPlaying) return;
    isPlaying=true; currentStep=0; currentBar=0; nextNoteTime=ctx.currentTime+.06; scheduler(); $('#playBtn').textContent='❚❚';
  }
  function stopSeq(){isPlaying=false;clearTimeout(timerId);currentStep=0;currentBar=0;paintCurrentStep(-1);$('#playBtn').textContent='▶';}

  function paintCurrentStep(step){
    $$('.step').forEach(el=>el.classList.toggle('current',Number(el.dataset.step)===step));
    $('#positionReadout').textContent=step<0?'1.1':`${currentBar+1}.${step+1}`;
  }

  function renderPads(){
    $('#pads').innerHTML=padDefs.map((p,i)=>`<button class="pad ${i===selectedPad?'selected':''}" data-index="${i}"><span>${p[0]}</span><small>${p[2]}</small></button>`).join('');
    $$('.pad').forEach(el=>{
      const i=Number(el.dataset.index);
      const hit=async(e)=>{e.preventDefault();await ensureAudio();selectPad(i);triggerPad(i);};
      el.addEventListener('pointerdown',hit,{passive:false});
    });
  }

  function renderGrid(){
    $('#stepNumbers').innerHTML='<span></span>'+Array.from({length:16},(_,i)=>`<span>${i+1}</span>`).join('');
    $('#seqGrid').innerHTML=pattern.map((row,i)=>`<div class="seq-row"><div class="seq-label">${padDefs[i][0]}</div>${row.map((v,s)=>`<button class="step ${s%4===0?'beat':''} ${v?'on':''}" data-pad="${i}" data-step="${s}" aria-label="${padDefs[i][0]} step ${s+1}"></button>`).join('')}</div>`).join('');
    $$('.step').forEach(el=>el.addEventListener('pointerdown',async(e)=>{e.preventDefault();await ensureAudio();const i=+el.dataset.pad,s=+el.dataset.step;pattern[i][s]=!pattern[i][s];el.classList.toggle('on',pattern[i][s]);if(pattern[i][s])triggerPad(i);saveState();}));
    applyLessonTargets();
  }

  function selectPad(i){selectedPad=i;renderPads();$('#selectedPadName').textContent=padDefs[i][0]+(importedBuffers[i]?' · Custom':'');$('#padVol').value=Math.round(padSettings[i].volume*100);$('#padPitch').value=padSettings[i].pitch;}

  async function loadTrack(file){
    await ensureAudio();
    try{trackBuffer=await ctx.decodeAudioData(await file.arrayBuffer());$('#trackName').textContent=file.name;$('#trackPlayBtn').disabled=false;$('#trackStopBtn').disabled=false;trackOffset=0;}catch(err){alert('That audio file could not be decoded. Try MP3 or WAV.');}
  }
  async function playTrack(){
    await ensureAudio(); if(!trackBuffer)return; stopTrack(false);
    trackSource=ctx.createBufferSource();trackSource.buffer=trackBuffer;trackSource.connect(trackGain);trackStartedAt=ctx.currentTime-trackOffset;trackSource.start(0,trackOffset%trackBuffer.duration);trackSource.onended=()=>{trackSource=null;trackOffset=0;};
  }
  function stopTrack(reset=true){
    if(trackSource){try{trackOffset=(ctx.currentTime-trackStartedAt)%trackBuffer.duration;trackSource.stop();}catch{}trackSource=null;}
    if(reset)trackOffset=0;
  }

  function loadStarter(){
    pattern=padDefs.map(()=>Array(STEPS).fill(false));
    [0,8,11].forEach(s=>pattern[0][s]=true);[4,12].forEach(s=>pattern[2][s]=true);[0,2,4,6,8,10,12,14].forEach(s=>pattern[6][s]=true);pattern[7][14]=true;pattern[4][12]=true;renderGrid();saveState();
  }

  function setMode(mode){
    $$('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    $('#learnPanel').classList.toggle('hidden',mode!=='learn');
    if(mode==='learn'){lessonIndex=0;updateLesson();}
  }
  function updateLesson(){
    const l=lessonSteps[lessonIndex];$('#lessonText').textContent=l.text;$('#lessonProgress').textContent=`Step ${lessonIndex+1} of ${lessonSteps.length}`;$('#nextLesson').textContent=lessonIndex===lessonSteps.length-1?'RESTART':'NEXT';applyLessonTargets();
  }
  function applyLessonTargets(){
    $$('.step').forEach(e=>e.classList.remove('lesson-target'));
    if($('#learnPanel').classList.contains('hidden'))return;
    lessonSteps[lessonIndex].targets.forEach(([p,s])=>$(`.step[data-pad="${p}"][data-step="${s}"]`)?.classList.add('lesson-target'));
  }

  async function importSample(file){
    await ensureAudio();
    try{importedBuffers[selectedPad]=await ctx.decodeAudioData(await file.arrayBuffer());$('#selectedPadName').textContent=padDefs[selectedPad][0]+' · Custom';triggerPad(selectedPad);}catch{alert('Could not decode that sample. Try WAV or MP3.');}
  }

  function setupRecorder(){
    if(!window.MediaRecorder){alert('Recording is not supported in this browser.');return false;}
    let mime=''; for(const t of ['audio/webm;codecs=opus','audio/mp4','audio/webm']){if(MediaRecorder.isTypeSupported(t)){mime=t;break;}}
    recorder=new MediaRecorder(mediaDest.stream,mime?{mimeType:mime}:undefined);recordingChunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)recordingChunks.push(e.data)};
    recorder.onstop=()=>{const blob=new Blob(recordingChunks,{type:recorder.mimeType||'audio/webm'});const url=URL.createObjectURL(blob);const a=$('#downloadRecording'),p=$('#recordingPlayback');p.src=url;p.classList.remove('hidden');a.href=url;a.download=(recorder.mimeType||'').includes('mp4')?'blaze-beat-lab.m4a':'blaze-beat-lab.webm';a.classList.remove('hidden');$('#recordStatus').textContent='Recording ready';};
    return true;
  }

  async function toggleRecord(){
    await ensureAudio();
    if(!recorder || recorder.state==='inactive'){
      if(!setupRecorder())return; recorder.start(250);$('#recordBtn').classList.add('recording');$('#recordStatus').textContent='Recording…';
    }else{recorder.stop();$('#recordBtn').classList.remove('recording');}
  }

  function saveState(){
    const state={pattern,padSettings,bpm:$('#bpm').value,swing:$('#swing').value,bars:$('#bars').value,master:$('#masterVol').value,trackVol:$('#trackVol').value};
    localStorage.setItem('blazeBeatLabV1',JSON.stringify(state));
  }
  function restoreState(){
    try{const s=JSON.parse(localStorage.getItem('blazeBeatLabV1'));if(!s)return;if(Array.isArray(s.pattern)&&s.pattern.length===padDefs.length)pattern=s.pattern;if(Array.isArray(s.padSettings))padSettings=s.padSettings;$('#bpm').value=s.bpm||94;$('#swing').value=s.swing||18;$('#bars').value=s.bars||2;$('#masterVol').value=s.master||85;$('#trackVol').value=s.trackVol||70;}catch{}
  }
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

  function wireUI(){
    $('#startAudio').addEventListener('pointerdown',async(e)=>{e.preventDefault();const state=await ensureAudio();if(state==='running'){triggerPad(0,ctx.currentTime+.01);$('#boot').classList.add('hidden');}else{$('#startAudio').textContent='TAP AGAIN TO ENABLE AUDIO';}});
    $('#playBtn').addEventListener('click',()=>isPlaying?stopSeq():startSeq());$('#stopBtn').addEventListener('click',()=>{stopSeq();stopTrack();});$('#recordBtn').addEventListener('click',toggleRecord);
    $('#tapBtn').addEventListener('pointerdown',()=>{const n=performance.now();tapTimes=tapTimes.filter(t=>n-t<2400);tapTimes.push(n);if(tapTimes.length>1){const dif=tapTimes.slice(1).map((t,i)=>t-tapTimes[i]);$('#bpm').value=clamp(Math.round(60000/(dif.reduce((a,b)=>a+b,0)/dif.length)),50,200);saveState();}});
    $$('.mode').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
    $('#trackInput').addEventListener('change',e=>e.target.files[0]&&loadTrack(e.target.files[0]));$('#trackPlayBtn').addEventListener('click',playTrack);$('#trackStopBtn').addEventListener('click',()=>stopTrack());
    $('#trackVol').addEventListener('input',e=>{if(trackGain)trackGain.gain.value=e.target.value/100;saveState();});$('#masterVol').addEventListener('input',e=>{if(master)master.gain.value=e.target.value/100;saveState();});
    $('#padVol').addEventListener('input',e=>{padSettings[selectedPad].volume=e.target.value/100;saveState();});$('#padPitch').addEventListener('input',e=>{padSettings[selectedPad].pitch=+e.target.value;saveState();});
    $('#sampleInput').addEventListener('change',e=>e.target.files[0]&&importSample(e.target.files[0]));$('#resetPad').addEventListener('click',()=>{importedBuffers[selectedPad]=null;padSettings[selectedPad]={volume:1,pitch:0};selectPad(selectedPad);});
    $('#clearPattern').addEventListener('click',()=>{pattern=padDefs.map(()=>Array(STEPS).fill(false));renderGrid();saveState();});$('#demoPattern').addEventListener('click',loadStarter);$('#saveProject').addEventListener('click',()=>{saveState();$('#saveProject').textContent='SAVED ✓';setTimeout(()=>$('#saveProject').textContent='SAVE',1000);});
    $('#nextLesson').addEventListener('click',()=>{lessonIndex=(lessonIndex+1)%lessonSteps.length;updateLesson();});
    $('#helpBtn').addEventListener('click',()=>$('#helpDialog').showModal());$('#closeHelp').addEventListener('click',()=>$('#helpDialog').close());
    ['bpm','swing','bars'].forEach(id=>$(`#${id}`).addEventListener('change',saveState));
  }

  document.addEventListener('visibilitychange',()=>{ if(!document.hidden && ctx && (ctx.state==='suspended' || ctx.state==='interrupted')) ctx.resume().catch(()=>{}); });
  restoreState();renderPads();renderGrid();wireUI();
})();
