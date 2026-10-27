/* Lehrerzimmer – Webseiten-Version: stellt db, room und user über Firebase bereit
   (gleiche Schnittstelle wie auf claude.ai, damit app.js unverändert bleibt).
   Ohne Konfiguration in config.js läuft die Seite ohne Online-Teil. */
const V="10.12.2",B=window.FB_BASE||`https://www.gstatic.com/firebasejs/${V}/`;
async function boot(){
  const cfg=window.FIREBASE_CONFIG;
  if(!cfg||!cfg.apiKey||!cfg.databaseURL) return null;
  const [{initializeApp},A,D]=await Promise.all([
    import(B+"firebase-app.js"),import(B+"firebase-auth.js"),import(B+"firebase-database.js")]);
  const {getDatabase,ref,get,set,update,remove,onValue,runTransaction,onDisconnect}=D;
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
  // Wer ist da: online/<uid> bzw. rooms/<name>/<uid>, beim Verlassen automatisch entfernt
  function peersAt(path,cb,err){return onValue(ref(dbi,path),s=>{const v=s.val()||{};const peers=Object.keys(v).map(k=>({peer:k,by:k,isMe:k===uid,sameTab:k===uid,kind:"viewer",guest:false,presence:v[k]||{},updatedAt:Date.now()}));cb({peers,joined:[],left:[],updated:[]});},e=>err&&err({code:"upstream_error",message:String(e)}));}
  async function presenceAt(path,p){const r=ref(dbi,path);await onDisconnect(r).remove();await set(r,clean(Object.assign({t:Date.now()},p)));}
  const room={
    presence:p=>presenceAt("online/"+uid,p),
    onPeers:(cb,err)=>peersAt("online",cb,err),
    connected:()=>true,
    // Züge laufen über die Datenbank (sie ist selbst live), der Raum meldet nur, wer da ist
    join:async name=>({name,emit:async()=>{},on:()=>()=>{},
      presence:p=>presenceAt(`rooms/${name}/${uid}`,p),
      onPeers:(cb,err)=>peersAt(`rooms/${name}`,cb,err),
      connected:()=>true,leave:()=>remove(ref(dbi,`rooms/${name}/${uid}`))})
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
      try{const r=await signInWithEmailAndPassword(auth,mail(name),pass);let n="";try{n=(await get(ref(dbi,"names/"+r.user.uid))).val()||"";}catch(e){}
        try{localStorage.setItem(LSN,n||String(name).trim());}catch(e){}return {ok:true};}catch(e){return {error:errText(e)};}},
    async logout(){try{localStorage.removeItem(LSN);}catch(e){}await signOut(auth);return {ok:true};}
  };
  window.LZ_SITE.setName=async n=>{n=String(n||"").replace(/[\u0000-\u001f<>]/g,"").trim().slice(0,24);try{localStorage.setItem(LSN,n);}catch(e){}await set(ref(dbi,"names/"+uid),n||null).catch(()=>{});return n;};
  return {db,room,user};
}
boot().then(api=>window.__fbResolve(api),e=>{console.warn("Firebase nicht verfügbar:",e);window.__fbResolve(null);});
