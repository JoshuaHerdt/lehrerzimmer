/* Lehrerzimmer – Webseiten-Version: stellt db, room und user über Firebase bereit
   (gleiche Schnittstelle wie auf claude.ai, damit app.js unverändert bleibt).
   Ohne Konfiguration in config.js läuft die Seite ohne Online-Teil. */
const V="10.12.2",B=window.FB_BASE||`https://www.gstatic.com/firebasejs/${V}/`;
async function boot(){
  const cfg=window.FIREBASE_CONFIG;
  if(!cfg||!cfg.apiKey||!cfg.databaseURL) return null;
  const [{initializeApp},A,D]=await Promise.all([
    import(B+"firebase-app.js"),import(B+"firebase-auth.js"),import(B+"firebase-database.js")]);
  const {getDatabase,ref,get,set,update,remove,onValue,runTransaction,onDisconnect,serverTimestamp,goOffline,goOnline}=D;
  const {getAuth,signInAnonymously,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,signOut,EmailAuthProvider,linkWithCredential}=A;
  const app=initializeApp(cfg),auth=getAuth(app),dbi=getDatabase(app);
  // Bestehende Sitzung (Konto oder Gast) übernehmen, sonst als Gast anonym anmelden
  let cur=await new Promise(res=>{const off=onAuthStateChanged(auth,u=>{off();res(u);});});
  if(!cur) cur=(await signInAnonymously(auth)).user;
  const uid=cur.uid;
  const mp=p=>p.startsWith("data/users/")?"users/"+p.slice(11):p;
  const clean=d=>JSON.parse(JSON.stringify(d,(k,v)=>v===undefined?null:v));
  const snap=(s,id)=>({id,exists:s.exists(),data:()=>s.val()??undefined,metadata:{fromCache:false,hasPendingWrites:false}});
  function docRef(path){const r=ref(dbi,mp(path)),id=path.split("/").pop();return {id,path,
    get:async()=>snap(await get(r),id),
    set:d=>set(r,clean(d)),
    update:d=>update(r,clean(d)),
    delete:()=>remove(r),
    acquire:async({holder,ttlMs})=>{const lr=ref(dbi,"leases/"+mp(path).replace(/\//g,"|")),now=Date.now();
      const t=await runTransaction(lr,cur=>{if(cur&&cur.exp>now&&cur.h!==holder)return;return {h:holder,exp:now+(ttlMs||30000)};});
      return {acquired:t.committed,holder};},
    onSnapshot:(next,err)=>onValue(r,s=>next(snap(s,id)),e=>err&&err({code:"unavailable",message:String(e)})),
    collection:p=>collRef(path+"/"+p)};}
  function collRef(path){const r=ref(dbi,mp(path));
    const docsOf=s=>{const v=s.val()||{};return Object.keys(v).sort().map(k=>({id:k,exists:true,data:()=>v[k],metadata:{}}));};
    const qs=d=>({docs:d,size:d.length,empty:!d.length,docChanges:()=>[],metadata:{}});
    return {path,doc:id=>docRef(path+"/"+(id||Math.random().toString(36).slice(2,12))),
      get:async()=>qs(docsOf(await get(r))),
      onSnapshot:(next,err)=>onValue(r,s=>next(qs(docsOf(s))),e=>err&&err({code:"unavailable",message:String(e)}))};}
  const db={doc:docRef,collection:collRef};
  // Wer ist da: online/<uid> bzw. rooms/<name>/<uid>. Jeder Eintrag trägt eine Serverzeit und wird jede Minute erneuert,
  // solange die Seite sichtbar ist. Wer länger als 2,5 Minuten nichts erneuert hat, zählt nicht mehr als da.
  // Beim Schließen, Anmelden und Abmelden wird der eigene Eintrag sofort gelöscht: Firebase prüft den
  // onDisconnect-Auftrag mit der Anmeldung zum Zeitpunkt des Trennens, nach einem Kontowechsel würde er abgelehnt.
  const STALE=150e3,pres=new Map();let skew=0;
  onValue(ref(dbi,".info/serverTimeOffset"),s=>{skew=s.val()||0;});
  const visible=()=>typeof document==="undefined"||document.visibilityState!=="hidden";
  async function writePres(path){const r=ref(dbi,path);await onDisconnect(r).remove();await set(r,clean(Object.assign({},pres.get(path),{t:serverTimestamp()})));}
  async function dropPres(path){const r=ref(dbi,path);try{await onDisconnect(r).cancel();}catch(e){}try{await remove(r);}catch(e){}}
  const dropAll=()=>Promise.all([...pres.keys()].map(dropPres));
  const refreshAll=()=>{if(visible())pres.forEach((p,path)=>writePres(path).catch(()=>{}));};
  setInterval(refreshAll,60e3);
  onValue(ref(dbi,".info/connected"),s=>{if(s.val())refreshAll();});
  document.addEventListener("visibilitychange",()=>{if(visible())refreshAll();});
  // Beim Verlassen die Verbindung sauber schließen, dann führt der Server die onDisconnect-Löschung sofort aus
  addEventListener("pagehide",()=>{try{goOffline(dbi);}catch(e){}});
  addEventListener("pageshow",e=>{if(e.persisted){goOnline(dbi);refreshAll();}});
  // Einträge ohne Lebenszeichen seit über 10 Minuten räumt jeder Besucher weg (die Regeln erlauben genau das)
  const swept=new Set();
  const sweep=(path,v)=>{const n=Date.now()+skew;Object.keys(v).forEach(k=>{const t=v[k]&&v[k].t;
    if(k===uid||swept.has(path+"/"+k)||(typeof t==="number"&&n-t<660e3))return;swept.add(path+"/"+k);remove(ref(dbi,path+"/"+k)).catch(()=>{});});};
  const fresh=(k,v)=>k===uid||(v&&typeof v.t==="number"&&Date.now()+skew-v.t<STALE);
  function peersAt(path,cb,err){let last=null;const emit=()=>{const v=last||{};const peers=Object.keys(v).filter(k=>fresh(k,v[k])).map(k=>({peer:k,by:k,isMe:k===uid,sameTab:k===uid,kind:"viewer",guest:false,presence:v[k]||{},updatedAt:Date.now()}));cb({peers,joined:[],left:[],updated:[]});};
    const tick=setInterval(()=>{if(last)emit();},30e3);
    const off=onValue(ref(dbi,path),s=>{last=s.val()||{};emit();sweep(path,last);},e=>err&&err({code:"upstream_error",message:String(e)}));
    return ()=>{clearInterval(tick);off();};}
  async function presenceAt(path,p){pres.set(path,p);if(visible())await writePres(path);}
  const room={
    presence:p=>presenceAt("online/"+uid,p),
    onPeers:(cb,err)=>peersAt("online",cb,err),
    connected:()=>true,
    // Züge laufen über die Datenbank (sie ist selbst live), der Raum meldet nur, wer da ist
    join:async name=>({name,emit:async()=>{},on:()=>()=>{},
      presence:p=>presenceAt(`rooms/${name}/${uid}`,p),
      onPeers:(cb,err)=>peersAt(`rooms/${name}`,cb,err),
      connected:()=>true,leave:()=>{const path=`rooms/${name}/${uid}`;pres.delete(path);return dropPres(path);}})
  };
  const LSN="lz-site-name";
  const myName=()=>{try{return localStorage.getItem(LSN)||""}catch(e){return ""}};
  if(!cur.isAnonymous&&!myName()){try{const n=(await get(ref(dbi,"names/"+uid))).val();if(n)localStorage.setItem(LSN,n);}catch(e){}}
  if(myName()) set(ref(dbi,"names/"+uid),myName().slice(0,24)).catch(()=>{});
  const user={
    id:async()=>uid,name:async()=>myName()||"Spieler "+uid.slice(0,4).toUpperCase(),
    me:async()=>({id:uid,name:myName()}),isOwner:async()=>false,canEdit:async()=>true,can:async()=>true,
    profiles:async ids=>{const out={};await Promise.all(ids.map(async id=>{let n="";try{n=(await get(ref(dbi,"names/"+id))).val()||"";}catch(e){}out[id]={id,name:n||"Spieler "+String(id).slice(0,4).toUpperCase(),isMe:id===uid};}));return out;}
  };
  // Konten: Name + Passwort (intern als Kunst-E-Mail, es wird nie eine E-Mail verschickt)
  const norm=n=>String(n||"").trim().toLowerCase().replace(/ä/g,"ae").replace(/ö/g,"oe").replace(/ü/g,"ue").replace(/ß/g,"ss").replace(/[^a-z0-9._-]/g,"");
  const mail=n=>norm(n)+"@spieler.lehrerzimmer-arena.app";
  const errText=e=>{const c=e&&e.code||"";
    if(/email-already-in-use/.test(c))return "Dieser Name ist schon vergeben.";
    if(/weak-password/.test(c))return "Das Passwort braucht mindestens 6 Zeichen.";
    if(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c))return "Name oder Passwort stimmt nicht.";
    if(/too-many-requests/.test(c))return "Zu viele Versuche. Warte kurz und versuch es noch einmal.";
    if(/network/.test(c))return "Keine Internetverbindung.";
    return "Das hat nicht geklappt ("+c+").";};
  const checkName=n=>{const t=String(n||"").trim();if(norm(t).length<3)return "Der Name braucht mindestens 3 Buchstaben oder Ziffern.";if(t.length>20)return "Der Name darf höchstens 20 Zeichen haben.";return "";};
  window.LZ_SITE.auth={
    info:{uid,account:!cur.isAnonymous,name:myName()},
    async register(name,pass){const bad=checkName(name);if(bad)return {error:bad};
      try{const cred=EmailAuthProvider.credential(mail(name),pass);await linkWithCredential(auth.currentUser,cred);
        await set(ref(dbi,"names/"+uid),String(name).trim().slice(0,24));try{localStorage.setItem(LSN,String(name).trim().slice(0,24));}catch(e){}
        return {ok:true};}catch(e){return {error:errText(e)};}},
    async login(name,pass){if(!norm(name))return {error:"Gib deinen Namen ein."};
      await dropAll();
      try{const r=await signInWithEmailAndPassword(auth,mail(name),pass);let n="";try{n=(await get(ref(dbi,"names/"+r.user.uid))).val()||"";}catch(e){}
        try{localStorage.setItem(LSN,n||String(name).trim());}catch(e){}return {ok:true};}catch(e){refreshAll();return {error:errText(e)};}},
    async logout(){try{localStorage.removeItem(LSN);}catch(e){}await dropAll();await signOut(auth);return {ok:true};}
  };
  window.LZ_SITE.setName=async n=>{n=String(n||"").replace(/[\u0000-\u001f<>]/g,"").trim().slice(0,24);try{localStorage.setItem(LSN,n);}catch(e){}await set(ref(dbi,"names/"+uid),n||null).catch(()=>{});return n;};
  return {db,room,user};
}
boot().then(api=>window.__fbResolve(api),e=>{console.warn("Firebase nicht verfügbar:",e);window.__fbResolve(null);});
